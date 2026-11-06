import { BadRequestException, Injectable } from '@nestjs/common';
import { DeviceStatus, Prisma } from '@prisma/client';
import {
  ACCESSORY_DEVICE_TYPES,
  SECTION_DEVICE_TYPE,
} from '../constants/safeguardable-device-types.const';
import { SAFEGUARD_INCLUDE } from '../constants/safeguard-query.const';
import {
  CreateFromEmployeeDevicesInput,
  SafeguardWithDetails,
} from '../types/safeguard.types';

/**
 * Builds a new version of an employee's safeguard from the devices assigned
 * now (always inside the caller's transaction) and closes the current one.
 */
@Injectable()
export class SafeguardGenerationService {
  async createFromEmployeeDevices(
    tx: Prisma.TransactionClient,
    employeeId: string,
    input: CreateFromEmployeeDevicesInput,
  ): Promise<SafeguardWithDetails> {
    const employee = await tx.employee.findUniqueOrThrow({
      where: { id: employeeId },
    });

    const assignedDevices = await tx.deviceItem.findMany({
      where: {
        employeeId,
        status: DeviceStatus.ASSIGNED,
        catalog: {
          type: {
            in: [SECTION_DEVICE_TYPE.computer, SECTION_DEVICE_TYPE.mobile],
          },
        },
      },
      include: { catalog: true },
    });

    const computerDevice = assignedDevices.find(
      (d) => d.catalog.type === SECTION_DEVICE_TYPE.computer,
    );
    const mobileDevice = assignedDevices.find(
      (d) => d.catalog.type === SECTION_DEVICE_TYPE.mobile,
    );

    if (!computerDevice && !mobileDevice) {
      throw new BadRequestException(
        'El empleado no tiene ningún equipo de cómputo o celular asignado actualmente',
      );
    }

    const existing = await tx.safeguard.findFirst({
      where: { employeeId, supersededAt: null },
      include: SAFEGUARD_INCLUDE,
    });

    const usageType = input.usageType ?? existing?.usageType;
    if (!usageType) {
      throw new BadRequestException(
        'usageType es obligatorio para generar la primera responsiva del empleado',
      );
    }
    const startDate = input.startDate ?? existing?.startDate ?? null;
    const endDate = input.endDate ?? existing?.endDate ?? null;

    const computerData = computerDevice
      ? await this.buildComputerSection(tx, computerDevice)
      : undefined;
    const mobileData = mobileDevice
      ? this.buildMobileSection(mobileDevice, existing, input.mobileAccessories)
      : undefined;

    if (existing) {
      await tx.safeguard.update({
        where: { id: existing.id },
        data: { supersededAt: new Date() },
      });
    }

    const sectionsData = {
      ...(computerData && { computer: { create: computerData } }),
      ...(mobileData && { mobile: { create: mobileData } }),
    };

    const safeguard = await tx.safeguard.create({
      data: {
        employeeId,
        branchId: employee.branchId,
        employeeName: employee.name,
        position: employee.position,
        area: employee.department,
        usageType,
        startDate,
        endDate,
        createdByUserId: input.createdByUserId,
        ...sectionsData,
      },
      include: SAFEGUARD_INCLUDE,
    });

    await tx.employee.update({
      where: { id: employeeId },
      data: { hasSignedResponsibility: false },
    });

    return safeguard;
  }

  async closeCurrentForEmployee(
    tx: Prisma.TransactionClient,
    employeeId: string,
  ) {
    await tx.safeguard.updateMany({
      where: { employeeId, supersededAt: null },
      data: { supersededAt: new Date() },
    });
  }

  private async buildComputerSection(
    tx: Prisma.TransactionClient,
    device: Prisma.DeviceItemGetPayload<{ include: { catalog: true } }>,
  ) {
    const accessoryDevices = await tx.deviceItem.findMany({
      where: {
        mainDeviceId: device.id,
        catalog: { type: { in: ACCESSORY_DEVICE_TYPES } },
      },
      include: { catalog: true },
    });

    return {
      deviceId: device.id,
      brand: device.catalog.brand,
      model: device.catalog.model,
      serialNumber: device.serialNumber,
      internalCode: device.internalCode,
      hardDrive: device.hardDrive,
      processor: device.processor,
      condition: device.condition,
      observations: device.notes,
      ...(accessoryDevices.length && {
        accessoryDetails: {
          create: accessoryDevices.map((a) => ({
            deviceId: a.id,
            name: a.catalog.name,
            brand: a.catalog.brand,
            model: a.catalog.model,
            serialNumber: a.serialNumber,
            internalCode: a.internalCode,
          })),
        },
      }),
    };
  }

  private buildMobileSection(
    device: Prisma.DeviceItemGetPayload<{ include: { catalog: true } }>,
    existing: SafeguardWithDetails | null,
    mobileAccessoriesInput?: string[],
  ) {
    let mobileAccessories: string[];
    if (mobileAccessoriesInput) {
      mobileAccessories = mobileAccessoriesInput;
    } else if (existing?.mobile?.deviceId === device.id) {
      mobileAccessories = existing.mobile.accessoryDetails.map((a) => a.name);
    } else {
      mobileAccessories = [];
    }

    return {
      deviceId: device.id,
      brand: device.catalog.brand,
      model: device.catalog.model,
      serialNumber: device.serialNumber,
      internalCode: device.internalCode,
      imei: device.imei,
      phoneNumber: device.phoneNumber,
      condition: device.condition,
      observations: device.notes,
      ...(mobileAccessories.length && {
        accessoryDetails: {
          create: mobileAccessories.map((name) => ({ name })),
        },
      }),
    };
  }
}
