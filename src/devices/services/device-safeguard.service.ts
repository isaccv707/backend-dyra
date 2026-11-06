import { Injectable } from '@nestjs/common';
import { DeviceStatus, DeviceType, Prisma } from '@prisma/client';
import { getSafeguardSectionForType } from 'src/safeguards/constants/safeguardable-device-types.const';
import { SafeguardsService } from 'src/safeguards/safeguards.service';
import { SafeguardAssignmentFields } from '../types/device.types';

/** Regenerates an employee's safeguard when their assigned devices change. */
@Injectable()
export class DeviceSafeguardService {
  constructor(private readonly safeguardsService: SafeguardsService) {}

  async triggerSafeguardForAssignment(
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
}
