import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DeviceStatus, Prisma, TransferStatus } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import {
  assertBranchAccess,
  BranchScopedUser,
  userBranchFilter,
} from 'src/common/utils/branch-access.util';
import {
  buildPaginatedQuery,
  paginatedResponse,
} from 'src/common/utils/paginate.util';
import {
  VEHICLE_TRANSFER_ALLOWED_FIELDS,
  VEHICLE_TRANSFER_INCLUDE,
} from '../constants/vehicle-includes.const';
import { CancelVehicleTransferDto } from '../dto/cancel-vehicle-transfer.dto';
import { CreateVehicleTransferDto } from '../dto/create-vehicle-transfer.dto';
import { FindVehicleTransfersDto } from '../dto/find-vehicle-transfers.dto';
import { RejectVehicleTransferDto } from '../dto/reject-vehicle-transfer.dto';

/** Transfers of vehicles between branches and their lifecycle. */
@Injectable()
export class VehicleTransferService {
  constructor(private readonly prisma: PrismaService) {}

  async createTransfer(dto: CreateVehicleTransferDto, user: BranchScopedUser) {
    if (dto.originBranchId === dto.destinationBranchId) {
      throw new BadRequestException(
        'La sucursal de origen y destino no pueden ser la misma',
      );
    }
    assertBranchAccess(user, dto.originBranchId);

    const [originBranch, destinationBranch] = await Promise.all([
      this.prisma.branch.findUnique({ where: { id: dto.originBranchId } }),
      this.prisma.branch.findUnique({ where: { id: dto.destinationBranchId } }),
    ]);
    if (!originBranch) {
      throw new NotFoundException(
        `Branch with ID '${dto.originBranchId}' not found`,
      );
    }
    if (!destinationBranch) {
      throw new NotFoundException(
        `Branch with ID '${dto.destinationBranchId}' not found`,
      );
    }

    const vehicleIds = dto.items.map((i) => i.vehicleId);
    const vehicles = await this.prisma.vehicleItem.findMany({
      where: { id: { in: vehicleIds } },
    });

    if (vehicles.length !== vehicleIds.length) {
      const foundIds = new Set(vehicles.map((v) => v.id));
      const missing = vehicleIds.filter((id) => !foundIds.has(id));
      throw new NotFoundException(
        `VehicleItem(s) not found: ${missing.join(', ')}`,
      );
    }

    const wrongBranch = vehicles.filter(
      (v) => v.currentBranchId !== dto.originBranchId,
    );
    if (wrongBranch.length) {
      throw new BadRequestException(
        `Los siguientes vehículos no pertenecen a la sucursal de origen: ${wrongBranch.map((v) => v.internalCode).join(', ')}`,
      );
    }

    const notAvailable = vehicles.filter(
      (v) => v.status !== DeviceStatus.AVAILABLE,
    );
    if (notAvailable.length) {
      throw new BadRequestException(
        `Los siguientes vehículos no están disponibles para traspaso: ${notAvailable.map((v) => `${v.internalCode} (${v.status})`).join(', ')}`,
      );
    }

    try {
      return await this.prisma.vehicleTransferRequest.create({
        data: {
          originBranchId: dto.originBranchId,
          destinationBranchId: dto.destinationBranchId,
          notes: dto.notes,
          status: TransferStatus.PENDING,
          items: { create: vehicleIds.map((vehicleId) => ({ vehicleId })) },
        },
        include: VEHICLE_TRANSFER_INCLUDE,
      });
    } catch (error) {
      handleDatabaseErrors(error, 'VehicleTransferRequest');
    }
  }

  async initiateTransfer(id: string, user: BranchScopedUser) {
    const transfer = await this.getTransferOrThrow(id);
    assertBranchAccess(user, transfer.originBranchId);

    if (transfer.status !== TransferStatus.PENDING) {
      throw new BadRequestException(
        `No se puede iniciar una transferencia en estado ${transfer.status}`,
      );
    }

    const vehicleIds = transfer.items.map((i) => i.vehicleId);
    const notReady = transfer.items.filter(
      (i) => i.vehicle.status !== DeviceStatus.AVAILABLE,
    );
    if (notReady.length) {
      throw new BadRequestException(
        `Los siguientes vehículos ya no están disponibles: ${notReady.map((i) => i.vehicle.internalCode).join(', ')}`,
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.vehicleTransferRequest.update({
          where: { id },
          data: { status: TransferStatus.IN_TRANSIT },
        });

        await tx.vehicleItem.updateMany({
          where: { id: { in: vehicleIds } },
          data: { status: DeviceStatus.IN_TRANSFER },
        });

        await tx.vehicleMovementHistory.createMany({
          data: vehicleIds.map((vehicleId) => ({
            vehicleId,
            type: 'TRANSFER_OUT',
            originBranchId: transfer.originBranchId,
            destinationBranchId: transfer.destinationBranchId,
            details: `Salida hacia sucursal ${transfer.destinationBranch.name}`,
          })),
        });

        return tx.vehicleTransferRequest.findUniqueOrThrow({
          where: { id },
          include: VEHICLE_TRANSFER_INCLUDE,
        });
      });
    } catch (error) {
      handleDatabaseErrors(error, 'VehicleTransferRequest');
    }
  }

  async receiveTransfer(id: string, user: BranchScopedUser) {
    const transfer = await this.getTransferOrThrow(id);
    assertBranchAccess(user, transfer.destinationBranchId);

    if (transfer.status !== TransferStatus.IN_TRANSIT) {
      throw new BadRequestException(
        `No se puede recibir una transferencia en estado ${transfer.status}`,
      );
    }

    const vehicleIds = transfer.items.map((i) => i.vehicleId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.vehicleTransferRequest.update({
          where: { id },
          data: { status: TransferStatus.COMPLETED },
        });

        await tx.vehicleItem.updateMany({
          where: { id: { in: vehicleIds } },
          data: {
            currentBranchId: transfer.destinationBranchId,
            status: DeviceStatus.AVAILABLE,
          },
        });

        await tx.vehicleMovementHistory.createMany({
          data: vehicleIds.map((vehicleId) => ({
            vehicleId,
            type: 'TRANSFER_IN',
            originBranchId: transfer.originBranchId,
            destinationBranchId: transfer.destinationBranchId,
            details: `Recepción en sucursal ${transfer.destinationBranch.name}`,
          })),
        });

        return tx.vehicleTransferRequest.findUniqueOrThrow({
          where: { id },
          include: VEHICLE_TRANSFER_INCLUDE,
        });
      });
    } catch (error) {
      handleDatabaseErrors(error, 'VehicleTransferRequest');
    }
  }

  async cancelTransfer(
    id: string,
    dto: CancelVehicleTransferDto,
    user: BranchScopedUser,
  ) {
    const transfer = await this.getTransferOrThrow(id);
    assertBranchAccess(user, transfer.originBranchId);

    if (transfer.status !== TransferStatus.PENDING) {
      throw new BadRequestException(
        `Solo se pueden cancelar transferencias en estado PENDING (actual: ${transfer.status})`,
      );
    }

    try {
      return await this.prisma.vehicleTransferRequest.update({
        where: { id },
        data: {
          status: TransferStatus.CANCELLED,
          notes: dto.reason ?? transfer.notes,
        },
        include: VEHICLE_TRANSFER_INCLUDE,
      });
    } catch (error) {
      handleDatabaseErrors(error, 'VehicleTransferRequest');
    }
  }

  async rejectTransfer(
    id: string,
    dto: RejectVehicleTransferDto,
    user: BranchScopedUser,
  ) {
    const transfer = await this.getTransferOrThrow(id);
    assertBranchAccess(user, transfer.destinationBranchId);

    if (transfer.status !== TransferStatus.IN_TRANSIT) {
      throw new BadRequestException(
        `Solo se pueden rechazar transferencias en estado IN_TRANSIT (actual: ${transfer.status})`,
      );
    }

    const vehicleIds = transfer.items.map((i) => i.vehicleId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.vehicleTransferRequest.update({
          where: { id },
          data: {
            status: TransferStatus.REJECTED,
            notes: dto.reason ?? transfer.notes,
          },
        });

        await tx.vehicleItem.updateMany({
          where: { id: { in: vehicleIds } },
          data: { status: DeviceStatus.AVAILABLE },
        });

        return tx.vehicleTransferRequest.findUniqueOrThrow({
          where: { id },
          include: VEHICLE_TRANSFER_INCLUDE,
        });
      });
    } catch (error) {
      handleDatabaseErrors(error, 'VehicleTransferRequest');
    }
  }

  async findTransfers(dto: FindVehicleTransfersDto, user: BranchScopedUser) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: [],
      defaultSort: { createdAt: 'desc' },
      allowedFields: VEHICLE_TRANSFER_ALLOWED_FIELDS,
    });

    const finalWhere = {
      ...where,
      ...this.transferBranchScopedWhere(user, dto.branchId),
      ...(dto.status && { status: dto.status }),
    } as Prisma.VehicleTransferRequestWhereInput;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.vehicleTransferRequest.findMany({
        skip,
        take,
        where: finalWhere,
        orderBy,
        include: VEHICLE_TRANSFER_INCLUDE,
      }),
      this.prisma.vehicleTransferRequest.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOneTransfer(id: string) {
    return this.getTransferOrThrow(id);
  }

  private async getTransferOrThrow(id: string) {
    const transfer = await this.prisma.vehicleTransferRequest.findUnique({
      where: { id },
      include: VEHICLE_TRANSFER_INCLUDE,
    });
    if (!transfer) {
      throw new NotFoundException(
        `VehicleTransferRequest with ID '${id}' not found`,
      );
    }
    return transfer;
  }

  private transferBranchScopedWhere(
    user: BranchScopedUser,
    branchId?: string,
  ): Prisma.VehicleTransferRequestWhereInput {
    const { branchId: condition } = userBranchFilter(user, branchId) as {
      branchId?: unknown;
    };
    if (condition === undefined) return {};
    return {
      OR: [
        { originBranchId: condition as string },
        { destinationBranchId: condition as string },
      ],
    };
  }
}
