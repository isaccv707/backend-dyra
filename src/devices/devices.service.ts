import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateDeviceItemDto } from './dto/create-device-item.dto';
import { UpdateDeviceItemDto } from './dto/update-device-item.dto';
import { FindDevicesDto } from './dto/find-devices.dto';
import { FindMovementHistoryDto } from './dto/find-movement-history.dto';
import { AssignDeviceDto } from './dto/assign-device.dto';
import { RetireDeviceDto } from './dto/retire-device.dto';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { FindTransfersDto } from './dto/find-transfers.dto';
import { CancelTransferDto } from './dto/cancel-transfer.dto';
import { RejectTransferDto } from './dto/reject-transfer.dto';
import { PrismaService } from 'prisma/prisma/prisma.service';
import {
  DeviceStatus,
  DeviceType,
  OwnershipType,
  Prisma,
  SafeguardUsageType,
  TransferStatus,
} from '@prisma/client';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import {
  buildPaginatedQuery,
  paginatedResponse,
} from 'src/common/utils/paginate.util';
import {
  assertBranchAccess,
  BranchScopedUser,
  userBranchFilter,
} from 'src/common/utils/branch-access.util';
import { SafeguardsService } from 'src/safeguards/safeguards.service';
import {
  ACCESSORY_DEVICE_TYPES,
  getSafeguardSectionForType,
} from 'src/safeguards/constants/safeguardable-device-types.const';

interface SafeguardAssignmentFields {
  usageType?: SafeguardUsageType;
  startDate?: string;
  endDate?: string;
  mobileAccessories?: string[];
}

const DEVICE_ALLOWED_FIELDS = [
  'internalCode',
  'status',
  'condition',
  'createdAt',
];
const TRANSFER_ALLOWED_FIELDS = ['status', 'createdAt'];

const DEVICE_INCLUDE = {
  catalog: true,
  employee: true,
  location: true,
  currentBranch: { select: { id: true, name: true } },
} satisfies Prisma.DeviceItemInclude;

const TRANSFER_INCLUDE = {
  originBranch: { select: { id: true, name: true } },
  destinationBranch: { select: { id: true, name: true } },
  items: {
    include: {
      device: { select: { id: true, internalCode: true, status: true } },
    },
  },
} satisfies Prisma.TransferRequestInclude;

type AuthUser = BranchScopedUser & { id: string };

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly safeguardsService: SafeguardsService,
  ) {}

  async create(dto: CreateDeviceItemDto, user: AuthUser) {
    assertBranchAccess(user, dto.currentBranchId);

    if (dto.employeeId && dto.locationId) {
      throw new BadRequestException(
        'Un equipo no puede asignarse simultáneamente a un empleado y a una ubicación',
      );
    }

    const catalog = await this.prisma.deviceCatalog.findUnique({
      where: { id: dto.catalogId },
    });
    if (!catalog) {
      throw new NotFoundException(
        `DeviceCatalog with ID '${dto.catalogId}' not found`,
      );
    }

    const branch = await this.prisma.branch.findUnique({
      where: { id: dto.currentBranchId },
    });
    if (!branch) {
      throw new NotFoundException(
        `Branch with ID '${dto.currentBranchId}' not found`,
      );
    }

    if (
      (dto.hardDrive || dto.processor) &&
      catalog.type !== DeviceType.COMPUTER
    ) {
      throw new BadRequestException(
        'hardDrive/processor solo aplican a equipos de catálogo tipo COMPUTER',
      );
    }
    if ((dto.imei || dto.phoneNumber) && catalog.type !== DeviceType.MOBILE) {
      throw new BadRequestException(
        'imei/phoneNumber solo aplican a equipos de catálogo tipo MOBILE',
      );
    }

    const isAccessory = ACCESSORY_DEVICE_TYPES.includes(catalog.type);
    if (dto.mainDeviceId && !isAccessory) {
      throw new BadRequestException(
        'mainDeviceId solo aplica a equipos de catálogo tipo MONITOR/KEYBOARD/MOUSE',
      );
    }
    if (isAccessory && (dto.employeeId || dto.locationId)) {
      throw new BadRequestException(
        'Los accesorios (MONITOR/KEYBOARD/MOUSE) no se asignan directamente a un empleado/ubicación; enlácelos a una computadora con mainDeviceId',
      );
    }

    let mainDevice: Prisma.DeviceItemGetPayload<{
      include: { catalog: true };
    }> | null = null;
    if (dto.mainDeviceId) {
      mainDevice = await this.getDeviceOrThrow(dto.mainDeviceId);
      if (mainDevice.catalog.type !== DeviceType.COMPUTER) {
        throw new BadRequestException(
          'mainDeviceId debe apuntar a un equipo de catálogo tipo COMPUTER',
        );
      }
      if (mainDevice.currentBranchId !== dto.currentBranchId) {
        throw new BadRequestException(
          'El accesorio debe darse de alta en la misma sucursal que su computadora principal',
        );
      }
    }

    if (dto.employeeId) {
      await this.assertEmployeeInBranch(dto.employeeId, dto.currentBranchId);
    }
    if (dto.locationId) {
      await this.assertLocationInBranch(dto.locationId, dto.currentBranchId);
    }

    const employeeId = mainDevice ? mainDevice.employeeId : dto.employeeId;
    const locationId = mainDevice ? mainDevice.locationId : dto.locationId;
    const status = mainDevice
      ? mainDevice.status
      : dto.employeeId || dto.locationId
        ? DeviceStatus.ASSIGNED
        : DeviceStatus.AVAILABLE;

    const {
      usageType,
      startDate,
      endDate,
      mobileAccessories,
      ...deviceFields
    } = dto;

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.employeeId) {
          await this.assertNoDuplicateTypeForEmployee(
            tx,
            dto.employeeId,
            catalog.type,
          );
        }
        if (dto.mainDeviceId) {
          await this.assertNoDuplicateAccessoryTypeForMainDevice(
            tx,
            dto.mainDeviceId,
            catalog.type,
          );
        }

        const device = await tx.deviceItem.create({
          data: {
            ...deviceFields,
            employeeId,
            locationId,
            status,
          },
          include: DEVICE_INCLUDE,
        });

        await tx.deviceMovementHistory.create({
          data: {
            deviceId: device.id,
            type: 'ENTRY_PURCHASE',
            destinationBranchId: device.currentBranchId,
            details: `Alta de equipo ${device.internalCode} en sucursal ${branch.name}`,
          },
        });

        if (dto.employeeId) {
          await this.triggerSafeguardForAssignment(
            tx,
            dto.employeeId,
            catalog.type,
            user.id,
            {
              usageType,
              startDate,
              endDate,
              mobileAccessories,
            },
          );
        } else if (employeeId) {
          await this.triggerSafeguardForAssignment(
            tx,
            employeeId,
            catalog.type,
            user.id,
            {},
          );
        }

        return device;
      });
    } catch (error) {
      handleDatabaseErrors(error, 'DeviceItem');
    }
  }

  async findAll(dto: FindDevicesDto, user: BranchScopedUser) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['internalCode', 'serialNumber', 'imei'],
      defaultSort: { createdAt: 'desc' },
      allowedFields: DEVICE_ALLOWED_FIELDS,
    });

    const finalWhere = {
      ...where,
      ...this.branchScopedWhere('currentBranchId', user, dto.branchId),
      ...(dto.status && { status: dto.status }),
      ...(dto.employeeId && { employeeId: dto.employeeId }),
      ...(dto.locationId && { locationId: dto.locationId }),
      ...(dto.catalogId && { catalogId: dto.catalogId }),
    } as Prisma.DeviceItemWhereInput;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.deviceItem.findMany({
        skip,
        take,
        where: finalWhere,
        orderBy,
        include: DEVICE_INCLUDE,
      }),
      this.prisma.deviceItem.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOne(id: string) {
    const device = await this.prisma.deviceItem.findUnique({
      where: { id },
      include: DEVICE_INCLUDE,
    });

    if (!device) {
      throw new NotFoundException(`DeviceItem with ID '${id}' not found`);
    }

    return device;
  }

  async findMovementHistory(deviceId: string, dto: FindMovementHistoryDto) {
    await this.getDeviceOrThrow(deviceId);

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 10;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.deviceMovementHistory.findMany({
        where: { deviceId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.deviceMovementHistory.count({ where: { deviceId } }),
    ]);

    return paginatedResponse(data, total, page, limit);
  }

  async update(id: string, dto: UpdateDeviceItemDto, user: AuthUser) {
    const device = await this.getDeviceOrThrow(id);
    assertBranchAccess(user, device.currentBranchId);

    const effectiveOwnership = dto.ownershipType ?? device.ownershipType;
    const effectiveFolio = dto.providerFolio ?? device.providerFolio;
    if (effectiveOwnership === OwnershipType.PROVIDER && !effectiveFolio) {
      throw new BadRequestException(
        'providerFolio es obligatorio para equipos con ownershipType PROVIDER',
      );
    }

    if (
      (dto.hardDrive || dto.processor) &&
      device.catalog.type !== DeviceType.COMPUTER
    ) {
      throw new BadRequestException(
        'hardDrive/processor solo aplican a equipos de catálogo tipo COMPUTER',
      );
    }
    if (
      (dto.imei || dto.phoneNumber) &&
      device.catalog.type !== DeviceType.MOBILE
    ) {
      throw new BadRequestException(
        'imei/phoneNumber solo aplican a equipos de catálogo tipo MOBILE',
      );
    }
    if (
      dto.mainDeviceId &&
      !ACCESSORY_DEVICE_TYPES.includes(device.catalog.type)
    ) {
      throw new BadRequestException(
        'mainDeviceId solo aplica a equipos de catálogo tipo MONITOR/KEYBOARD/MOUSE',
      );
    }

    let inheritedFields:
      | {
          employeeId: string | null;
          locationId: string | null;
          status: DeviceStatus;
        }
      | undefined;
    if (dto.mainDeviceId) {
      const mainDevice = await this.getDeviceOrThrow(dto.mainDeviceId);
      if (mainDevice.catalog.type !== DeviceType.COMPUTER) {
        throw new BadRequestException(
          'mainDeviceId debe apuntar a un equipo de catálogo tipo COMPUTER',
        );
      }
      if (mainDevice.currentBranchId !== device.currentBranchId) {
        throw new BadRequestException(
          'El accesorio debe estar en la misma sucursal que su nueva computadora principal',
        );
      }
      inheritedFields = {
        employeeId: mainDevice.employeeId,
        locationId: mainDevice.locationId,
        status: mainDevice.status,
      };
    }

    const {
      usageType: _usageType,
      startDate: _startDate,
      endDate: _endDate,
      mobileAccessories: _mobileAccessories,
      ...deviceFields
    } = dto;

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.mainDeviceId) {
          await this.assertNoDuplicateAccessoryTypeForMainDevice(
            tx,
            dto.mainDeviceId,
            device.catalog.type,
            id,
          );
        }

        const updated = await tx.deviceItem.update({
          where: { id },
          data: {
            ...deviceFields,
            ...inheritedFields,
          },
          include: DEVICE_INCLUDE,
        });

        if (dto.mainDeviceId) {
          await tx.deviceMovementHistory.create({
            data: {
              deviceId: id,
              type: 'ASSIGNMENT',
              details: `Enlazado como accesorio a la computadora ${dto.mainDeviceId}`,
            },
          });

          if (inheritedFields?.employeeId) {
            await this.triggerSafeguardForAssignment(
              tx,
              inheritedFields.employeeId,
              device.catalog.type,
              user.id,
              {},
            );
          }
        }

        return updated;
      });
    } catch (error) {
      handleDatabaseErrors(error, 'DeviceItem');
    }
  }

  async assign(deviceId: string, dto: AssignDeviceDto, user: AuthUser) {
    const device = await this.getDeviceOrThrow(deviceId);
    assertBranchAccess(user, device.currentBranchId);

    if (ACCESSORY_DEVICE_TYPES.includes(device.catalog.type)) {
      throw new BadRequestException(
        'Los accesorios (MONITOR/KEYBOARD/MOUSE) no se asignan directamente; enlácelos a una computadora con mainDeviceId (POST /devices o PATCH /devices/:id)',
      );
    }

    if (dto.employeeId && dto.locationId) {
      throw new BadRequestException(
        'Un equipo no puede asignarse simultáneamente a un empleado y a una ubicación',
      );
    }
    if (!dto.employeeId && !dto.locationId) {
      throw new BadRequestException(
        'Debe indicar employeeId o locationId; use el endpoint de unassign para liberar el equipo',
      );
    }
    if (device.status !== DeviceStatus.AVAILABLE) {
      throw new BadRequestException(
        `No se puede asignar un equipo en estado ${device.status}`,
      );
    }

    if (dto.employeeId) {
      await this.assertEmployeeInBranch(dto.employeeId, device.currentBranchId);
    } else if (dto.locationId) {
      await this.assertLocationInBranch(dto.locationId, device.currentBranchId);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.employeeId) {
          await this.assertNoDuplicateTypeForEmployee(
            tx,
            dto.employeeId,
            device.catalog.type,
            deviceId,
          );
        }

        const updated = await tx.deviceItem.update({
          where: { id: deviceId },
          data: {
            employeeId: dto.employeeId ?? null,
            locationId: dto.locationId ?? null,
            status: DeviceStatus.ASSIGNED,
          },
          include: DEVICE_INCLUDE,
        });

        await this.cascadeToAccessories(tx, deviceId, {
          employeeId: updated.employeeId,
          locationId: updated.locationId,
          status: DeviceStatus.ASSIGNED,
        });

        await tx.deviceMovementHistory.create({
          data: {
            deviceId,
            type: 'ASSIGNMENT',
            details: dto.employeeId
              ? `Asignado al empleado ${updated.employee!.name}`
              : `Asignado a la ubicación ${updated.location!.name}`,
          },
        });

        if (dto.employeeId) {
          await this.triggerSafeguardForAssignment(
            tx,
            dto.employeeId,
            device.catalog.type,
            user.id,
            dto,
          );
        }

        return updated;
      });
    } catch (error) {
      handleDatabaseErrors(error, 'DeviceItem');
    }
  }

  async unassign(deviceId: string, user: BranchScopedUser) {
    const device = await this.getDeviceOrThrow(deviceId);
    assertBranchAccess(user, device.currentBranchId);

    if (!device.employeeId && !device.locationId) {
      throw new BadRequestException('El equipo ya está libre');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.deviceItem.update({
          where: { id: deviceId },
          data: {
            employeeId: null,
            locationId: null,
            status: DeviceStatus.AVAILABLE,
          },
          include: DEVICE_INCLUDE,
        });

        await this.cascadeToAccessories(tx, deviceId, {
          employeeId: null,
          locationId: null,
          status: DeviceStatus.AVAILABLE,
        });

        await tx.deviceMovementHistory.create({
          data: { deviceId, type: 'UNASSIGNMENT', details: 'Equipo liberado' },
        });

        return updated;
      });
    } catch (error) {
      handleDatabaseErrors(error, 'DeviceItem');
    }
  }

  async unlink(deviceId: string, user: AuthUser) {
    const device = await this.getDeviceOrThrow(deviceId);
    assertBranchAccess(user, device.currentBranchId);

    if (!ACCESSORY_DEVICE_TYPES.includes(device.catalog.type)) {
      throw new BadRequestException(
        'Solo los accesorios (MONITOR/KEYBOARD/MOUSE) se pueden desenlazar',
      );
    }
    if (!device.mainDeviceId) {
      throw new BadRequestException(
        'Este accesorio no está enlazado a ninguna computadora',
      );
    }

    const employeeId = device.employeeId;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.deviceItem.update({
          where: { id: deviceId },
          data: {
            mainDeviceId: null,
            employeeId: null,
            locationId: null,
            status: DeviceStatus.AVAILABLE,
          },
          include: DEVICE_INCLUDE,
        });

        await tx.deviceMovementHistory.create({
          data: {
            deviceId,
            type: 'UNLINK',
            details: 'Accesorio desenlazado de su computadora principal',
          },
        });

        if (employeeId) {
          await this.triggerSafeguardForAssignment(
            tx,
            employeeId,
            device.catalog.type,
            user.id,
            {},
          );
        }

        return updated;
      });
    } catch (error) {
      handleDatabaseErrors(error, 'DeviceItem');
    }
  }

  async retire(deviceId: string, dto: RetireDeviceDto, user: BranchScopedUser) {
    const device = await this.getDeviceOrThrow(deviceId);
    assertBranchAccess(user, device.currentBranchId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.deviceItem.update({
          where: { id: deviceId },
          data: {
            employeeId: null,
            locationId: null,
            status: DeviceStatus.RETIRED_DISPOSED,
            ...(dto.notes && { notes: dto.notes }),
          },
          include: DEVICE_INCLUDE,
        });

        await this.cascadeToAccessories(tx, deviceId, {
          mainDeviceId: null,
          employeeId: null,
          locationId: null,
          status: DeviceStatus.AVAILABLE,
        });

        await tx.deviceMovementHistory.create({
          data: {
            deviceId,
            type: 'DISPOSAL',
            details: dto.notes ?? `Baja del equipo ${device.internalCode}`,
          },
        });

        return updated;
      });
    } catch (error) {
      handleDatabaseErrors(error, 'DeviceItem');
    }
  }

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

  private async triggerSafeguardForAssignment(
    tx: Prisma.TransactionClient,
    employeeId: string,
    catalogType: DeviceType,
    createdByUserId: string,
    fields: SafeguardAssignmentFields,
  ) {
    const sectionKey = getSafeguardSectionForType(catalogType);

    if (!sectionKey) {
      const hasComputer = await tx.deviceItem.findFirst({
        where: {
          employeeId,
          status: DeviceStatus.ASSIGNED,
          catalog: { type: DeviceType.COMPUTER },
        },
      });
      if (!hasComputer) return;

      await this.safeguardsService.createFromEmployeeDevices(tx, employeeId, {
        createdByUserId,
      });
      return;
    }

    await this.safeguardsService.createFromEmployeeDevices(tx, employeeId, {
      usageType: fields.usageType,
      startDate: fields.startDate ? new Date(fields.startDate) : undefined,
      endDate: fields.endDate ? new Date(fields.endDate) : undefined,
      createdByUserId,
      mobileAccessories: fields.mobileAccessories,
    });
  }

  private async assertNoDuplicateTypeForEmployee(
    tx: Prisma.TransactionClient,
    employeeId: string,
    catalogType: DeviceType,
    excludeDeviceId?: string,
  ) {
    const conflict = await tx.deviceItem.findFirst({
      where: {
        employeeId,
        status: DeviceStatus.ASSIGNED,
        catalog: { type: catalogType },
        ...(excludeDeviceId && { id: { not: excludeDeviceId } }),
      },
    });
    if (conflict) {
      throw new BadRequestException(
        `El empleado ya tiene un equipo de tipo ${catalogType} asignado (${conflict.internalCode}); libérelo antes de asignar otro`,
      );
    }
  }

  private async assertNoDuplicateAccessoryTypeForMainDevice(
    tx: Prisma.TransactionClient,
    mainDeviceId: string,
    catalogType: DeviceType,
    excludeDeviceId?: string,
  ) {
    const conflict = await tx.deviceItem.findFirst({
      where: {
        mainDeviceId,
        catalog: { type: catalogType },
        ...(excludeDeviceId && { id: { not: excludeDeviceId } }),
      },
    });
    if (conflict) {
      throw new BadRequestException(
        `Esta computadora ya tiene un accesorio de tipo ${catalogType} enlazado (${conflict.internalCode}); libérelo antes de enlazar otro`,
      );
    }
  }

  private async cascadeToAccessories(
    tx: Prisma.TransactionClient,
    mainDeviceId: string,
    data: Prisma.DeviceItemUncheckedUpdateManyInput,
  ) {
    await tx.deviceItem.updateMany({ where: { mainDeviceId }, data });
  }

  private async getDeviceOrThrow(id: string) {
    const device = await this.prisma.deviceItem.findUnique({
      where: { id },
      include: { catalog: true },
    });
    if (!device) {
      throw new NotFoundException(`DeviceItem with ID '${id}' not found`);
    }
    return device;
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

  private async assertEmployeeInBranch(employeeId: string, branchId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) {
      throw new NotFoundException(`Employee with ID '${employeeId}' not found`);
    }
    if (employee.branchId !== branchId) {
      throw new BadRequestException('El empleado pertenece a otra sucursal');
    }
    if (!employee.isActive) {
      throw new BadRequestException(
        'No se puede asignar equipo a un empleado dado de baja',
      );
    }
  }

  async releaseAllForEmployee(
    tx: Prisma.TransactionClient,
    employeeId: string,
    reason: string,
  ) {
    const mainDevices = await tx.deviceItem.findMany({
      where: { employeeId, mainDeviceId: null },
    });

    for (const device of mainDevices) {
      await tx.deviceItem.update({
        where: { id: device.id },
        data: {
          employeeId: null,
          locationId: null,
          status: DeviceStatus.AVAILABLE,
        },
      });

      await this.cascadeToAccessories(tx, device.id, {
        employeeId: null,
        locationId: null,
        status: DeviceStatus.AVAILABLE,
      });

      await tx.deviceMovementHistory.create({
        data: { deviceId: device.id, type: 'UNASSIGNMENT', details: reason },
      });
    }
  }

  private async assertLocationInBranch(locationId: string, branchId: string) {
    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
    });
    if (!location) {
      throw new NotFoundException(`Location with ID '${locationId}' not found`);
    }
    if (location.branchId !== branchId) {
      throw new BadRequestException('La ubicación pertenece a otra sucursal');
    }
  }

  private branchScopedWhere(
    field: string,
    user: BranchScopedUser,
    branchId?: string,
  ) {
    const { branchId: condition } = userBranchFilter(user, branchId) as {
      branchId?: unknown;
    };
    return condition !== undefined ? { [field]: condition } : {};
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
