import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateVehicleItemDto } from './dto/create-vehicle-item.dto';
import { UpdateVehicleItemDto } from './dto/update-vehicle-item.dto';
import { FindVehiclesDto } from './dto/find-vehicles.dto';
import { FindVehicleMovementHistoryDto } from './dto/find-vehicle-movement-history.dto';
import { AssignVehicleDto } from './dto/assign-vehicle.dto';
import { RetireVehicleDto } from './dto/retire-vehicle.dto';
import { CreateVehicleTransferDto } from './dto/create-vehicle-transfer.dto';
import { FindVehicleTransfersDto } from './dto/find-vehicle-transfers.dto';
import { CancelVehicleTransferDto } from './dto/cancel-vehicle-transfer.dto';
import { RejectVehicleTransferDto } from './dto/reject-vehicle-transfer.dto';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { DeviceStatus, Prisma, SafeguardUsageType, TransferStatus } from '@prisma/client';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { buildPaginatedQuery, paginatedResponse } from 'src/common/utils/paginate.util';
import { assertBranchAccess, BranchScopedUser, userBranchFilter } from 'src/common/utils/branch-access.util';
import { VehicleSafeguardsService } from 'src/vehicle-safeguards/vehicle-safeguards.service';
import { VehicleSafeguardInspectionItemDto } from 'src/vehicle-safeguards/dto/vehicle-safeguard-inspection-item.dto';

// Forma mínima compartida por AssignVehicleDto y los campos de resguardo de
// CreateVehicleItemDto: lo que triggerVehicleSafeguardForAssignment necesita
// para generar/regenerar el resguardo, sin acoplarse a un DTO en particular.
interface VehicleSafeguardAssignmentFields {
  usageType?: SafeguardUsageType;
  startDate?: string;
  endDate?: string;
  inspectionItems?: VehicleSafeguardInspectionItemDto[];
}

const VEHICLE_ALLOWED_FIELDS = ['internalCode', 'status', 'condition', 'createdAt'];
const VEHICLE_TRANSFER_ALLOWED_FIELDS = ['status', 'createdAt'];

const VEHICLE_INCLUDE = {
  catalog: true,
  employee: true,
  location: true,
  currentBranch: { select: { id: true, name: true } },
} satisfies Prisma.VehicleItemInclude;

const VEHICLE_TRANSFER_INCLUDE = {
  originBranch: { select: { id: true, name: true } },
  destinationBranch: { select: { id: true, name: true } },
  items: { include: { vehicle: { select: { id: true, internalCode: true, status: true } } } },
} satisfies Prisma.VehicleTransferRequestInclude;

type AuthUser = BranchScopedUser & { id: string };

@Injectable()
export class VehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vehicleSafeguardsService: VehicleSafeguardsService,
  ) {}

  // ---------------------------------------------------------------------
  // Alta / lectura de vehículos
  // ---------------------------------------------------------------------

  async create(dto: CreateVehicleItemDto, user: AuthUser) {
    assertBranchAccess(user, dto.currentBranchId);

    if (dto.employeeId && dto.locationId) {
      throw new BadRequestException(
        'Un vehículo no puede asignarse simultáneamente a un empleado y a una ubicación',
      );
    }

    const catalog = await this.prisma.vehicleCatalog.findUnique({ where: { id: dto.catalogId } });
    if (!catalog) {
      throw new NotFoundException(`VehicleCatalog with ID '${dto.catalogId}' not found`);
    }

    const branch = await this.prisma.branch.findUnique({ where: { id: dto.currentBranchId } });
    if (!branch) {
      throw new NotFoundException(`Branch with ID '${dto.currentBranchId}' not found`);
    }

    if (dto.employeeId) {
      await this.assertEmployeeInBranch(dto.employeeId, dto.currentBranchId);
    }
    if (dto.locationId) {
      await this.assertLocationInBranch(dto.locationId, dto.currentBranchId);
    }

    const status = dto.employeeId || dto.locationId ? DeviceStatus.ASSIGNED : DeviceStatus.AVAILABLE;
    const { usageType, startDate, endDate, inspectionItems, ...vehicleFields } = dto;

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.employeeId) {
          await this.assertEmployeeHasNoActiveVehicle(tx, dto.employeeId);
        }

        const vehicle = await tx.vehicleItem.create({
          data: { ...vehicleFields, status },
          include: VEHICLE_INCLUDE,
        });

        await tx.vehicleMovementHistory.create({
          data: {
            vehicleId: vehicle.id,
            type: 'ENTRY_PURCHASE',
            destinationBranchId: vehicle.currentBranchId,
            details: `Alta de vehículo ${vehicle.internalCode} en sucursal ${branch.name}`,
          },
        });

        if (dto.employeeId) {
          await this.triggerVehicleSafeguardForAssignment(tx, dto.employeeId, user.id, {
            usageType,
            startDate,
            endDate,
            inspectionItems,
          });
        }

        return vehicle;
      });
    } catch (error) {
      handleDatabaseErrors(error, 'VehicleItem');
    }
  }

  async findAll(dto: FindVehiclesDto, user: BranchScopedUser) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['internalCode', 'plateNumber'],
      defaultSort: { createdAt: 'desc' },
      allowedFields: VEHICLE_ALLOWED_FIELDS,
    });

    const finalWhere = {
      ...where,
      ...this.branchScopedWhere(user, dto.branchId),
      ...(dto.status && { status: dto.status }),
      ...(dto.employeeId && { employeeId: dto.employeeId }),
      ...(dto.locationId && { locationId: dto.locationId }),
      ...(dto.catalogId && { catalogId: dto.catalogId }),
    } as Prisma.VehicleItemWhereInput;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.vehicleItem.findMany({ skip, take, where: finalWhere, orderBy, include: VEHICLE_INCLUDE }),
      this.prisma.vehicleItem.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOne(id: string) {
    const vehicle = await this.prisma.vehicleItem.findUnique({ where: { id }, include: VEHICLE_INCLUDE });
    if (!vehicle) {
      throw new NotFoundException(`VehicleItem with ID '${id}' not found`);
    }
    return vehicle;
  }

  async findMovementHistory(vehicleId: string, dto: FindVehicleMovementHistoryDto) {
    await this.getVehicleOrThrow(vehicleId);

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 10;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.vehicleMovementHistory.findMany({
        where: { vehicleId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.vehicleMovementHistory.count({ where: { vehicleId } }),
    ]);

    return paginatedResponse(data, total, page, limit);
  }

  async update(id: string, dto: UpdateVehicleItemDto, user: AuthUser) {
    const vehicle = await this.getVehicleOrThrow(id);
    assertBranchAccess(user, vehicle.currentBranchId);

    const effectiveOwnership = dto.ownershipType ?? vehicle.ownershipType;
    const effectiveFolio = dto.providerFolio ?? vehicle.providerFolio;
    if (effectiveOwnership === 'PROVIDER' && !effectiveFolio) {
      throw new BadRequestException('providerFolio es obligatorio para vehículos con ownershipType PROVIDER');
    }

    // usageType/startDate/endDate/inspectionItems son términos de resguardo
    // heredados de CreateVehicleItemDto, no columnas de VehicleItem — se
    // descartan aquí; PATCH nunca toca employeeId ni regenera resguardos.
    const { usageType: _usageType, startDate: _startDate, endDate: _endDate, inspectionItems: _inspectionItems, ...vehicleFields } = dto;

    try {
      return await this.prisma.vehicleItem.update({
        where: { id },
        data: vehicleFields,
        include: VEHICLE_INCLUDE,
      });
    } catch (error) {
      handleDatabaseErrors(error, 'VehicleItem');
    }
  }

  // ---------------------------------------------------------------------
  // Asignación exclusiva
  // ---------------------------------------------------------------------

  async assign(vehicleId: string, dto: AssignVehicleDto, user: AuthUser) {
    const vehicle = await this.getVehicleOrThrow(vehicleId);
    assertBranchAccess(user, vehicle.currentBranchId);

    if (dto.employeeId && dto.locationId) {
      throw new BadRequestException(
        'Un vehículo no puede asignarse simultáneamente a un empleado y a una ubicación',
      );
    }
    if (!dto.employeeId && !dto.locationId) {
      throw new BadRequestException(
        'Debe indicar employeeId o locationId; use el endpoint de unassign para liberar el vehículo',
      );
    }
    if (vehicle.status !== DeviceStatus.AVAILABLE) {
      throw new BadRequestException(`No se puede asignar un vehículo en estado ${vehicle.status}`);
    }

    if (dto.employeeId) {
      await this.assertEmployeeInBranch(dto.employeeId, vehicle.currentBranchId);
    } else if (dto.locationId) {
      await this.assertLocationInBranch(dto.locationId, vehicle.currentBranchId);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.employeeId) {
          await this.assertEmployeeHasNoActiveVehicle(tx, dto.employeeId, vehicleId);
        }

        const updated = await tx.vehicleItem.update({
          where: { id: vehicleId },
          data: {
            employeeId: dto.employeeId ?? null,
            locationId: dto.locationId ?? null,
            status: DeviceStatus.ASSIGNED,
          },
          include: VEHICLE_INCLUDE,
        });

        await tx.vehicleMovementHistory.create({
          data: {
            vehicleId,
            type: 'ASSIGNMENT',
            details: dto.employeeId
              ? `Asignado al empleado ${updated.employee!.name}`
              : `Asignado a la ubicación ${updated.location!.name}`,
          },
        });

        if (dto.employeeId) {
          await this.triggerVehicleSafeguardForAssignment(tx, dto.employeeId, user.id, dto);
        }

        return updated;
      });
    } catch (error) {
      handleDatabaseErrors(error, 'VehicleItem');
    }
  }

  async unassign(vehicleId: string, user: BranchScopedUser) {
    const vehicle = await this.getVehicleOrThrow(vehicleId);
    assertBranchAccess(user, vehicle.currentBranchId);

    if (!vehicle.employeeId && !vehicle.locationId) {
      throw new BadRequestException('El vehículo ya está libre');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.vehicleItem.update({
          where: { id: vehicleId },
          data: { employeeId: null, locationId: null, status: DeviceStatus.AVAILABLE },
          include: VEHICLE_INCLUDE,
        });

        await tx.vehicleMovementHistory.create({
          data: { vehicleId, type: 'UNASSIGNMENT', details: 'Vehículo liberado' },
        });

        return updated;
      });
    } catch (error) {
      handleDatabaseErrors(error, 'VehicleItem');
    }
  }

  async retire(vehicleId: string, dto: RetireVehicleDto, user: BranchScopedUser) {
    const vehicle = await this.getVehicleOrThrow(vehicleId);
    assertBranchAccess(user, vehicle.currentBranchId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.vehicleItem.update({
          where: { id: vehicleId },
          data: {
            employeeId: null,
            locationId: null,
            status: DeviceStatus.RETIRED_DISPOSED,
            ...(dto.notes && { notes: dto.notes }),
          },
          include: VEHICLE_INCLUDE,
        });

        await tx.vehicleMovementHistory.create({
          data: {
            vehicleId,
            type: 'DISPOSAL',
            details: dto.notes ?? `Baja del vehículo ${vehicle.internalCode}`,
          },
        });

        return updated;
      });
    } catch (error) {
      handleDatabaseErrors(error, 'VehicleItem');
    }
  }

  // Libera todo el equipo (aquí: el vehículo) que un empleado tiene
  // actualmente asignado. Usado por EmployeesService.offboard — corre dentro
  // de la misma transacción que la baja del empleado y el cierre de su
  // resguardo vigente.
  async releaseAllForEmployee(tx: Prisma.TransactionClient, employeeId: string, reason: string) {
    const vehicles = await tx.vehicleItem.findMany({ where: { employeeId } });

    for (const vehicle of vehicles) {
      await tx.vehicleItem.update({
        where: { id: vehicle.id },
        data: { employeeId: null, locationId: null, status: DeviceStatus.AVAILABLE },
      });

      await tx.vehicleMovementHistory.create({
        data: { vehicleId: vehicle.id, type: 'UNASSIGNMENT', details: reason },
      });
    }
  }

  // ---------------------------------------------------------------------
  // Traspasos entre sucursales (2 pasos, transaccional)
  // ---------------------------------------------------------------------

  async createTransfer(dto: CreateVehicleTransferDto, user: BranchScopedUser) {
    if (dto.originBranchId === dto.destinationBranchId) {
      throw new BadRequestException('La sucursal de origen y destino no pueden ser la misma');
    }
    assertBranchAccess(user, dto.originBranchId);

    const [originBranch, destinationBranch] = await Promise.all([
      this.prisma.branch.findUnique({ where: { id: dto.originBranchId } }),
      this.prisma.branch.findUnique({ where: { id: dto.destinationBranchId } }),
    ]);
    if (!originBranch) {
      throw new NotFoundException(`Branch with ID '${dto.originBranchId}' not found`);
    }
    if (!destinationBranch) {
      throw new NotFoundException(`Branch with ID '${dto.destinationBranchId}' not found`);
    }

    const vehicleIds = dto.items.map((i) => i.vehicleId);
    const vehicles = await this.prisma.vehicleItem.findMany({ where: { id: { in: vehicleIds } } });

    if (vehicles.length !== vehicleIds.length) {
      const foundIds = new Set(vehicles.map((v) => v.id));
      const missing = vehicleIds.filter((id) => !foundIds.has(id));
      throw new NotFoundException(`VehicleItem(s) not found: ${missing.join(', ')}`);
    }

    const wrongBranch = vehicles.filter((v) => v.currentBranchId !== dto.originBranchId);
    if (wrongBranch.length) {
      throw new BadRequestException(
        `Los siguientes vehículos no pertenecen a la sucursal de origen: ${wrongBranch.map((v) => v.internalCode).join(', ')}`,
      );
    }

    const notAvailable = vehicles.filter((v) => v.status !== DeviceStatus.AVAILABLE);
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
      throw new BadRequestException(`No se puede iniciar una transferencia en estado ${transfer.status}`);
    }

    const vehicleIds = transfer.items.map((i) => i.vehicleId);
    const notReady = transfer.items.filter((i) => i.vehicle.status !== DeviceStatus.AVAILABLE);
    if (notReady.length) {
      throw new BadRequestException(
        `Los siguientes vehículos ya no están disponibles: ${notReady.map((i) => i.vehicle.internalCode).join(', ')}`,
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.vehicleTransferRequest.update({ where: { id }, data: { status: TransferStatus.IN_TRANSIT } });

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

        return tx.vehicleTransferRequest.findUniqueOrThrow({ where: { id }, include: VEHICLE_TRANSFER_INCLUDE });
      });
    } catch (error) {
      handleDatabaseErrors(error, 'VehicleTransferRequest');
    }
  }

  async receiveTransfer(id: string, user: BranchScopedUser) {
    const transfer = await this.getTransferOrThrow(id);
    assertBranchAccess(user, transfer.destinationBranchId);

    if (transfer.status !== TransferStatus.IN_TRANSIT) {
      throw new BadRequestException(`No se puede recibir una transferencia en estado ${transfer.status}`);
    }

    const vehicleIds = transfer.items.map((i) => i.vehicleId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.vehicleTransferRequest.update({ where: { id }, data: { status: TransferStatus.COMPLETED } });

        await tx.vehicleItem.updateMany({
          where: { id: { in: vehicleIds } },
          data: { currentBranchId: transfer.destinationBranchId, status: DeviceStatus.AVAILABLE },
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

        return tx.vehicleTransferRequest.findUniqueOrThrow({ where: { id }, include: VEHICLE_TRANSFER_INCLUDE });
      });
    } catch (error) {
      handleDatabaseErrors(error, 'VehicleTransferRequest');
    }
  }

  async cancelTransfer(id: string, dto: CancelVehicleTransferDto, user: BranchScopedUser) {
    const transfer = await this.getTransferOrThrow(id);
    assertBranchAccess(user, transfer.originBranchId);

    if (transfer.status !== TransferStatus.PENDING) {
      throw new BadRequestException(`Solo se pueden cancelar transferencias en estado PENDING (actual: ${transfer.status})`);
    }

    try {
      return await this.prisma.vehicleTransferRequest.update({
        where: { id },
        data: { status: TransferStatus.CANCELLED, notes: dto.reason ?? transfer.notes },
        include: VEHICLE_TRANSFER_INCLUDE,
      });
    } catch (error) {
      handleDatabaseErrors(error, 'VehicleTransferRequest');
    }
  }

  async rejectTransfer(id: string, dto: RejectVehicleTransferDto, user: BranchScopedUser) {
    const transfer = await this.getTransferOrThrow(id);
    assertBranchAccess(user, transfer.destinationBranchId);

    if (transfer.status !== TransferStatus.IN_TRANSIT) {
      throw new BadRequestException(`Solo se pueden rechazar transferencias en estado IN_TRANSIT (actual: ${transfer.status})`);
    }

    const vehicleIds = transfer.items.map((i) => i.vehicleId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.vehicleTransferRequest.update({
          where: { id },
          data: { status: TransferStatus.REJECTED, notes: dto.reason ?? transfer.notes },
        });

        await tx.vehicleItem.updateMany({
          where: { id: { in: vehicleIds } },
          data: { status: DeviceStatus.AVAILABLE },
        });

        return tx.vehicleTransferRequest.findUniqueOrThrow({ where: { id }, include: VEHICLE_TRANSFER_INCLUDE });
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
      this.prisma.vehicleTransferRequest.findMany({ skip, take, where: finalWhere, orderBy, include: VEHICLE_TRANSFER_INCLUDE }),
      this.prisma.vehicleTransferRequest.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOneTransfer(id: string) {
    return this.getTransferOrThrow(id);
  }

  // ---------------------------------------------------------------------
  // Helpers privados
  // ---------------------------------------------------------------------

  private async triggerVehicleSafeguardForAssignment(
    tx: Prisma.TransactionClient,
    employeeId: string,
    createdByUserId: string,
    fields: VehicleSafeguardAssignmentFields,
  ) {
    await this.vehicleSafeguardsService.createFromEmployeeVehicle(tx, employeeId, {
      usageType: fields.usageType,
      startDate: fields.startDate ? new Date(fields.startDate) : undefined,
      endDate: fields.endDate ? new Date(fields.endDate) : undefined,
      createdByUserId,
      inspectionItems: fields.inspectionItems,
    });
  }

  private async assertEmployeeHasNoActiveVehicle(
    tx: Prisma.TransactionClient,
    employeeId: string,
    excludeVehicleId?: string,
  ) {
    const conflict = await tx.vehicleItem.findFirst({
      where: {
        employeeId,
        status: DeviceStatus.ASSIGNED,
        ...(excludeVehicleId && { id: { not: excludeVehicleId } }),
      },
    });
    if (conflict) {
      throw new BadRequestException(
        `El empleado ya tiene un vehículo asignado (${conflict.internalCode}); libérelo antes de asignar otro`,
      );
    }
  }

  private async getVehicleOrThrow(id: string) {
    const vehicle = await this.prisma.vehicleItem.findUnique({ where: { id }, include: { catalog: true } });
    if (!vehicle) {
      throw new NotFoundException(`VehicleItem with ID '${id}' not found`);
    }
    return vehicle;
  }

  private async getTransferOrThrow(id: string) {
    const transfer = await this.prisma.vehicleTransferRequest.findUnique({ where: { id }, include: VEHICLE_TRANSFER_INCLUDE });
    if (!transfer) {
      throw new NotFoundException(`VehicleTransferRequest with ID '${id}' not found`);
    }
    return transfer;
  }

  private async assertEmployeeInBranch(employeeId: string, branchId: string) {
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) {
      throw new NotFoundException(`Employee with ID '${employeeId}' not found`);
    }
    if (employee.branchId !== branchId) {
      throw new BadRequestException('El empleado pertenece a otra sucursal');
    }
    if (!employee.isActive) {
      throw new BadRequestException('No se puede asignar un vehículo a un empleado dado de baja');
    }
  }

  private async assertLocationInBranch(locationId: string, branchId: string) {
    const location = await this.prisma.location.findUnique({ where: { id: locationId } });
    if (!location) {
      throw new NotFoundException(`Location with ID '${locationId}' not found`);
    }
    if (location.branchId !== branchId) {
      throw new BadRequestException('La ubicación pertenece a otra sucursal');
    }
  }

  private branchScopedWhere(user: BranchScopedUser, branchId?: string) {
    const { branchId: condition } = userBranchFilter(user, branchId) as { branchId?: unknown };
    return condition !== undefined ? { currentBranchId: condition } : {};
  }

  private transferBranchScopedWhere(user: BranchScopedUser, branchId?: string): Prisma.VehicleTransferRequestWhereInput {
    const { branchId: condition } = userBranchFilter(user, branchId) as { branchId?: unknown };
    if (condition === undefined) return {};
    return { OR: [{ originBranchId: condition as string }, { destinationBranchId: condition as string }] };
  }
}
