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
  TRANSFER_ALLOWED_FIELDS,
  TRANSFER_INCLUDE,
} from '../constants/device-includes.const';
import { CancelTransferDto } from '../dto/cancel-transfer.dto';
import { CreateTransferDto } from '../dto/create-transfer.dto';
import { FindTransfersDto } from '../dto/find-transfers.dto';
import { RejectTransferDto } from '../dto/reject-transfer.dto';

/** Transfers of devices between branches and their lifecycle. */
@Injectable()
export class DeviceTransferService {
  constructor(private readonly prisma: PrismaService) {}

  async createTransfer(dto: CreateTransferDto, user: BranchScopedUser) {
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

    const deviceIds = dto.items.map((i) => i.deviceId);
    const devices = await this.prisma.deviceItem.findMany({
      where: { id: { in: deviceIds } },
    });

    if (devices.length !== deviceIds.length) {
      const foundIds = new Set(devices.map((d) => d.id));
      const missing = deviceIds.filter((id) => !foundIds.has(id));
      throw new NotFoundException(
        `DeviceItem(s) not found: ${missing.join(', ')}`,
      );
    }

    const wrongBranch = devices.filter(
      (d) => d.currentBranchId !== dto.originBranchId,
    );
    if (wrongBranch.length) {
      throw new BadRequestException(
        `Los siguientes equipos no pertenecen a la sucursal de origen: ${wrongBranch.map((d) => d.internalCode).join(', ')}`,
      );
    }

    const notAvailable = devices.filter(
      (d) => d.status !== DeviceStatus.AVAILABLE,
    );
    if (notAvailable.length) {
      throw new BadRequestException(
        `Los siguientes equipos no están disponibles para traspaso: ${notAvailable.map((d) => `${d.internalCode} (${d.status})`).join(', ')}`,
      );
    }

    const linkedAccessories = devices.filter((d) => d.mainDeviceId);
    if (linkedAccessories.length) {
      throw new BadRequestException(
        `Los siguientes equipos son accesorios enlazados a una computadora y viajan con ella, no se agregan sueltos a un traspaso: ${linkedAccessories.map((d) => d.internalCode).join(', ')}`,
      );
    }

    try {
      return await this.prisma.transferRequest.create({
        data: {
          originBranchId: dto.originBranchId,
          destinationBranchId: dto.destinationBranchId,
          notes: dto.notes,
          status: TransferStatus.PENDING,
          items: { create: deviceIds.map((deviceId) => ({ deviceId })) },
        },
        include: TRANSFER_INCLUDE,
      });
    } catch (error) {
      handleDatabaseErrors(error, 'TransferRequest');
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

    const deviceIds = transfer.items.map((i) => i.deviceId);
    const notReady = transfer.items.filter(
      (i) => i.device.status !== DeviceStatus.AVAILABLE,
    );
    if (notReady.length) {
      throw new BadRequestException(
        `Los siguientes equipos ya no están disponibles: ${notReady.map((i) => i.device.internalCode).join(', ')}`,
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.transferRequest.update({
          where: { id },
          data: { status: TransferStatus.IN_TRANSIT },
        });

        await tx.deviceItem.updateMany({
          where: { id: { in: deviceIds } },
          data: { status: DeviceStatus.IN_TRANSFER },
        });

        await tx.deviceItem.updateMany({
          where: { mainDeviceId: { in: deviceIds } },
          data: { status: DeviceStatus.IN_TRANSFER },
        });

        await tx.deviceMovementHistory.createMany({
          data: deviceIds.map((deviceId) => ({
            deviceId,
            type: 'TRANSFER_OUT',
            originBranchId: transfer.originBranchId,
            destinationBranchId: transfer.destinationBranchId,
            details: `Salida hacia sucursal ${transfer.destinationBranch.name}`,
          })),
        });

        return tx.transferRequest.findUniqueOrThrow({
          where: { id },
          include: TRANSFER_INCLUDE,
        });
      });
    } catch (error) {
      handleDatabaseErrors(error, 'TransferRequest');
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

    const deviceIds = transfer.items.map((i) => i.deviceId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.transferRequest.update({
          where: { id },
          data: { status: TransferStatus.COMPLETED },
        });

        await tx.deviceItem.updateMany({
          where: { id: { in: deviceIds } },
          data: {
            currentBranchId: transfer.destinationBranchId,
            status: DeviceStatus.AVAILABLE,
          },
        });

        await tx.deviceItem.updateMany({
          where: { mainDeviceId: { in: deviceIds } },
          data: {
            currentBranchId: transfer.destinationBranchId,
            status: DeviceStatus.AVAILABLE,
          },
        });

        await tx.deviceMovementHistory.createMany({
          data: deviceIds.map((deviceId) => ({
            deviceId,
            type: 'TRANSFER_IN',
            originBranchId: transfer.originBranchId,
            destinationBranchId: transfer.destinationBranchId,
            details: `Recepción en sucursal ${transfer.destinationBranch.name}`,
          })),
        });

        return tx.transferRequest.findUniqueOrThrow({
          where: { id },
          include: TRANSFER_INCLUDE,
        });
      });
    } catch (error) {
      handleDatabaseErrors(error, 'TransferRequest');
    }
  }

  async cancelTransfer(
    id: string,
    dto: CancelTransferDto,
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
      return await this.prisma.transferRequest.update({
        where: { id },
        data: {
          status: TransferStatus.CANCELLED,
          notes: dto.reason ?? transfer.notes,
        },
        include: TRANSFER_INCLUDE,
      });
    } catch (error) {
      handleDatabaseErrors(error, 'TransferRequest');
    }
  }

  async rejectTransfer(
    id: string,
    dto: RejectTransferDto,
    user: BranchScopedUser,
  ) {
    const transfer = await this.getTransferOrThrow(id);
    assertBranchAccess(user, transfer.destinationBranchId);

    if (transfer.status !== TransferStatus.IN_TRANSIT) {
      throw new BadRequestException(
        `Solo se pueden rechazar transferencias en estado IN_TRANSIT (actual: ${transfer.status})`,
      );
    }

    const deviceIds = transfer.items.map((i) => i.deviceId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.transferRequest.update({
          where: { id },
          data: {
            status: TransferStatus.REJECTED,
            notes: dto.reason ?? transfer.notes,
          },
        });

        await tx.deviceItem.updateMany({
          where: { id: { in: deviceIds } },
          data: { status: DeviceStatus.AVAILABLE },
        });

        await tx.deviceItem.updateMany({
          where: { mainDeviceId: { in: deviceIds } },
          data: { status: DeviceStatus.AVAILABLE },
        });

        return tx.transferRequest.findUniqueOrThrow({
          where: { id },
          include: TRANSFER_INCLUDE,
        });
      });
    } catch (error) {
      handleDatabaseErrors(error, 'TransferRequest');
    }
  }

  async findTransfers(dto: FindTransfersDto, user: BranchScopedUser) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: [],
      defaultSort: { createdAt: 'desc' },
      allowedFields: TRANSFER_ALLOWED_FIELDS,
    });

    const finalWhere = {
      ...where,
      ...this.transferBranchScopedWhere(user, dto.branchId),
      ...(dto.status && { status: dto.status }),
    } as Prisma.TransferRequestWhereInput;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.transferRequest.findMany({
        skip,
        take,
        where: finalWhere,
        orderBy,
        include: TRANSFER_INCLUDE,
      }),
      this.prisma.transferRequest.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOneTransfer(id: string) {
    return this.getTransferOrThrow(id);
  }

  private async getTransferOrThrow(id: string) {
    const transfer = await this.prisma.transferRequest.findUnique({
      where: { id },
      include: TRANSFER_INCLUDE,
    });
    if (!transfer) {
      throw new NotFoundException(`TransferRequest with ID '${id}' not found`);
    }
    return transfer;
  }

  private transferBranchScopedWhere(
    user: BranchScopedUser,
    branchId?: string,
  ): Prisma.TransferRequestWhereInput {
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
