import { BadRequestException, Injectable } from '@nestjs/common';
import { DeviceStatus, Prisma } from '@prisma/client';
import { getVehicleInspectionItemSection } from '../constants/vehicle-inspection-items.const';
import { VEHICLE_SAFEGUARD_INCLUDE } from '../constants/vehicle-safeguard-query.const';
import { VehicleSafeguardInspectionItemDto } from '../dto/vehicle-safeguard-inspection-item.dto';
import {
  CreateFromEmployeeVehicleInput,
  InspectionItemCreateInput,
  VehicleSafeguardWithDetails,
} from '../types/vehicle-safeguard.types';

/**
 * Builds a new version of an employee's vehicle safeguard from the vehicle
 * assigned now (inside the caller's transaction) and closes the current one.
 */
@Injectable()
export class VehicleSafeguardGenerationService {
  async createFromEmployeeVehicle(
    tx: Prisma.TransactionClient,
    employeeId: string,
    input: CreateFromEmployeeVehicleInput,
  ): Promise<VehicleSafeguardWithDetails> {
    const employee = await tx.employee.findUniqueOrThrow({
      where: { id: employeeId },
    });

    const vehicle = await tx.vehicleItem.findFirst({
      where: { employeeId, status: DeviceStatus.ASSIGNED },
      include: { catalog: true },
    });

    if (!vehicle) {
      throw new BadRequestException(
        'El empleado no tiene ningún vehículo asignado actualmente',
      );
    }

    const existing = await tx.vehicleSafeguard.findFirst({
      where: { employeeId, supersededAt: null },
      include: VEHICLE_SAFEGUARD_INCLUDE,
    });

    const usageType = input.usageType ?? existing?.usageType;
    if (!usageType) {
      throw new BadRequestException(
        'usageType es obligatorio para generar la primera responsiva del empleado',
      );
    }
    const startDate = input.startDate ?? existing?.startDate ?? null;
    const endDate = input.endDate ?? existing?.endDate ?? null;

    let inspectionItemsData: InspectionItemCreateInput[];
    if (input.inspectionItems) {
      inspectionItemsData = this.resolveInspectionItems(input.inspectionItems);
    } else if (existing?.vehicleId === vehicle.id) {
      inspectionItemsData = existing.inspectionItems.map((item) => ({
        itemKey: item.itemKey,
        section: item.section,
        state: item.state,
        observations: item.observations,
      }));
    } else {
      inspectionItemsData = [];
    }

    if (existing) {
      await tx.vehicleSafeguard.update({
        where: { id: existing.id },
        data: { supersededAt: new Date() },
      });
    }

    return tx.vehicleSafeguard.create({
      data: {
        employeeId,
        vehicleId: vehicle.id,
        branchId: employee.branchId,
        employeeName: employee.name,
        position: employee.position,
        area: employee.department,
        brand: vehicle.catalog.brand,
        model: vehicle.catalog.model,
        mileage: vehicle.mileage,
        plateNumber: vehicle.plateNumber,
        fuelType: vehicle.fuelType,
        transmission: vehicle.transmission,
        condition: vehicle.condition,
        usageType,
        startDate,
        endDate,
        createdByUserId: input.createdByUserId,
        ...(inspectionItemsData.length && {
          inspectionItems: { create: inspectionItemsData },
        }),
      },
      include: VEHICLE_SAFEGUARD_INCLUDE,
    });
  }

  async closeCurrentForEmployee(
    tx: Prisma.TransactionClient,
    employeeId: string,
  ) {
    await tx.vehicleSafeguard.updateMany({
      where: { employeeId, supersededAt: null },
      data: { supersededAt: new Date() },
    });
  }

  private resolveInspectionItems(items?: VehicleSafeguardInspectionItemDto[]) {
    if (!items?.length) return [];

    const keys = items.map((item) => item.itemKey);
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
    if (duplicates.length) {
      throw new BadRequestException(
        `itemKey duplicado(s) en inspectionItems: ${[...new Set(duplicates)].join(', ')}`,
      );
    }

    return items.map((item) => ({
      itemKey: item.itemKey,
      section: getVehicleInspectionItemSection(item.itemKey),
      state: item.state,
      observations: item.observations,
    }));
  }
}
