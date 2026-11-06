import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeviceStatus,
  DeviceType,
  OwnershipType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { assertBranchAccess } from 'src/common/utils/branch-access.util';
import { ACCESSORY_DEVICE_TYPES } from 'src/safeguards/constants/safeguardable-device-types.const';
import { DEVICE_INCLUDE } from '../constants/device-includes.const';
import { CreateDeviceItemDto } from '../dto/create-device-item.dto';
import { UpdateDeviceItemDto } from '../dto/update-device-item.dto';
import { AuthUser } from '../types/device.types';
import { DeviceSafeguardService } from './device-safeguard.service';
import { DeviceValidationService } from './device-validation.service';

/** Creates and edits devices. */
@Injectable()
export class DeviceWriteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validation: DeviceValidationService,
    private readonly safeguards: DeviceSafeguardService,
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
      mainDevice = await this.validation.getDeviceOrThrow(dto.mainDeviceId);
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
      await this.validation.assertEmployeeInBranch(
        dto.employeeId,
        dto.currentBranchId,
      );
    }
    if (dto.locationId) {
      await this.validation.assertLocationInBranch(
        dto.locationId,
        dto.currentBranchId,
      );
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
          await this.validation.assertNoDuplicateTypeForEmployee(
            tx,
            dto.employeeId,
            catalog.type,
          );
        }
        if (dto.mainDeviceId) {
          await this.validation.assertNoDuplicateAccessoryTypeForMainDevice(
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
          await this.safeguards.triggerSafeguardForAssignment(
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
          await this.safeguards.triggerSafeguardForAssignment(
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

  async update(id: string, dto: UpdateDeviceItemDto, user: AuthUser) {
    const device = await this.validation.getDeviceOrThrow(id);
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
      const mainDevice = await this.validation.getDeviceOrThrow(
        dto.mainDeviceId,
      );
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
          await this.validation.assertNoDuplicateAccessoryTypeForMainDevice(
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
            await this.safeguards.triggerSafeguardForAssignment(
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
}
