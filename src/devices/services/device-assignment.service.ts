import { BadRequestException, Injectable } from '@nestjs/common';
import { DeviceStatus, Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import {
  assertBranchAccess,
  BranchScopedUser,
} from 'src/common/utils/branch-access.util';
import { ACCESSORY_DEVICE_TYPES } from 'src/safeguards/constants/safeguardable-device-types.const';
import { DEVICE_INCLUDE } from '../constants/device-includes.const';
import { AssignDeviceDto } from '../dto/assign-device.dto';
import { RetireDeviceDto } from '../dto/retire-device.dto';
import { AuthUser } from '../types/device.types';
import { DeviceSafeguardService } from './device-safeguard.service';
import { DeviceValidationService } from './device-validation.service';

/** Who holds a device: assign, release, unlink accessories and retire. */
@Injectable()
export class DeviceAssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validation: DeviceValidationService,
    private readonly safeguards: DeviceSafeguardService,
  ) {}

  async assign(deviceId: string, dto: AssignDeviceDto, user: AuthUser) {
    const device = await this.validation.getDeviceOrThrow(deviceId);
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
      await this.validation.assertEmployeeInBranch(
        dto.employeeId,
        device.currentBranchId,
      );
    } else if (dto.locationId) {
      await this.validation.assertLocationInBranch(
        dto.locationId,
        device.currentBranchId,
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.employeeId) {
          await this.validation.assertNoDuplicateTypeForEmployee(
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
          await this.safeguards.triggerSafeguardForAssignment(
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
    const device = await this.validation.getDeviceOrThrow(deviceId);
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
    const device = await this.validation.getDeviceOrThrow(deviceId);
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
          await this.safeguards.triggerSafeguardForAssignment(
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
    const device = await this.validation.getDeviceOrThrow(deviceId);
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

  private async cascadeToAccessories(
    tx: Prisma.TransactionClient,
    mainDeviceId: string,
    data: Prisma.DeviceItemUncheckedUpdateManyInput,
  ) {
    await tx.deviceItem.updateMany({ where: { mainDeviceId }, data });
  }
}
