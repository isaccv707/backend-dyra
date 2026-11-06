import { BadRequestException, Injectable } from '@nestjs/common';
import { DeviceStatus, Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import {
  assertBranchAccess,
  BranchScopedUser,
} from 'src/common/utils/branch-access.util';
import { VEHICLE_INCLUDE } from '../constants/vehicle-includes.const';
import { AssignVehicleDto } from '../dto/assign-vehicle.dto';
import { RetireVehicleDto } from '../dto/retire-vehicle.dto';
import { AuthUser } from '../types/vehicle.types';
import { VehicleSafeguardService } from './vehicle-safeguard.service';
import { VehicleValidationService } from './vehicle-validation.service';

/** Who holds a vehicle: assign, release and retire. */
@Injectable()
export class VehicleAssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validation: VehicleValidationService,
    private readonly safeguards: VehicleSafeguardService,
  ) {}

  async assign(vehicleId: string, dto: AssignVehicleDto, user: AuthUser) {
    const vehicle = await this.validation.getVehicleOrThrow(vehicleId);
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
      throw new BadRequestException(
        `No se puede asignar un vehículo en estado ${vehicle.status}`,
      );
    }

    if (dto.employeeId) {
      await this.validation.assertEmployeeInBranch(
        dto.employeeId,
        vehicle.currentBranchId,
      );
    } else if (dto.locationId) {
      await this.validation.assertLocationInBranch(
        dto.locationId,
        vehicle.currentBranchId,
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.employeeId) {
          await this.validation.assertEmployeeHasNoActiveVehicle(
            tx,
            dto.employeeId,
            vehicleId,
          );
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
          await this.safeguards.triggerVehicleSafeguardForAssignment(
            tx,
            dto.employeeId,
            user.id,
            dto,
          );
        }

        return updated;
      });
    } catch (error) {
      handleDatabaseErrors(error, 'VehicleItem');
    }
  }

  async unassign(vehicleId: string, user: BranchScopedUser) {
    const vehicle = await this.validation.getVehicleOrThrow(vehicleId);
    assertBranchAccess(user, vehicle.currentBranchId);

    if (!vehicle.employeeId && !vehicle.locationId) {
      throw new BadRequestException('El vehículo ya está libre');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.vehicleItem.update({
          where: { id: vehicleId },
          data: {
            employeeId: null,
            locationId: null,
            status: DeviceStatus.AVAILABLE,
          },
          include: VEHICLE_INCLUDE,
        });

        await tx.vehicleMovementHistory.create({
          data: {
            vehicleId,
            type: 'UNASSIGNMENT',
            details: 'Vehículo liberado',
          },
        });

        return updated;
      });
    } catch (error) {
      handleDatabaseErrors(error, 'VehicleItem');
    }
  }

  async retire(
    vehicleId: string,
    dto: RetireVehicleDto,
    user: BranchScopedUser,
  ) {
    const vehicle = await this.validation.getVehicleOrThrow(vehicleId);
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

  async releaseAllForEmployee(
    tx: Prisma.TransactionClient,
    employeeId: string,
    reason: string,
  ) {
    const vehicles = await tx.vehicleItem.findMany({ where: { employeeId } });

    for (const vehicle of vehicles) {
      await tx.vehicleItem.update({
        where: { id: vehicle.id },
        data: {
          employeeId: null,
          locationId: null,
          status: DeviceStatus.AVAILABLE,
        },
      });

      await tx.vehicleMovementHistory.create({
        data: { vehicleId: vehicle.id, type: 'UNASSIGNMENT', details: reason },
      });
    }
  }
}
