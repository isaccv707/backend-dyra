import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { VehicleSafeguardsService } from 'src/vehicle-safeguards/vehicle-safeguards.service';
import { VehicleSafeguardAssignmentFields } from '../types/vehicle.types';

/** Regenerates an employee's vehicle safeguard when they get a vehicle. */
@Injectable()
export class VehicleSafeguardService {
  constructor(
    private readonly vehicleSafeguardsService: VehicleSafeguardsService,
  ) {}

  async triggerVehicleSafeguardForAssignment(
    tx: Prisma.TransactionClient,
    employeeId: string,
    createdByUserId: string,
    fields: VehicleSafeguardAssignmentFields,
  ) {
    await this.vehicleSafeguardsService.createFromEmployeeVehicle(
      tx,
      employeeId,
      {
        usageType: fields.usageType,
        startDate: fields.startDate ? new Date(fields.startDate) : undefined,
        endDate: fields.endDate ? new Date(fields.endDate) : undefined,
        createdByUserId,
        inspectionItems: fields.inspectionItems,
      },
    );
  }
}
