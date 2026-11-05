import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DeviceStatus } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { assertBranchAccess } from 'src/common/utils/branch-access.util';
import { VEHICLE_INCLUDE } from '../constants/vehicle-includes.const';
import { CreateVehicleItemDto } from '../dto/create-vehicle-item.dto';
import { UpdateVehicleItemDto } from '../dto/update-vehicle-item.dto';
import { AuthUser } from '../types/vehicle.types';
import { VehicleSafeguardService } from './vehicle-safeguard.service';
import { VehicleValidationService } from './vehicle-validation.service';

/** Creates and edits vehicles. */
@Injectable()
export class VehicleWriteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validation: VehicleValidationService,
    private readonly safeguards: VehicleSafeguardService,
  ) {}

  async create(dto: CreateVehicleItemDto, user: AuthUser) {
    assertBranchAccess(user, dto.currentBranchId);

    if (dto.employeeId && dto.locationId) {
      throw new BadRequestException(
        'Un vehículo no puede asignarse simultáneamente a un empleado y a una ubicación',
      );
    }

    const catalog = await this.prisma.vehicleCatalog.findUnique({
      where: { id: dto.catalogId },
    });
    if (!catalog) {
      throw new NotFoundException(
        `VehicleCatalog with ID '${dto.catalogId}' not found`,
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

    const status =
      dto.employeeId || dto.locationId
        ? DeviceStatus.ASSIGNED
        : DeviceStatus.AVAILABLE;
    const { usageType, startDate, endDate, inspectionItems, ...vehicleFields } =
      dto;

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.employeeId) {
          await this.validation.assertEmployeeHasNoActiveVehicle(
            tx,
            dto.employeeId,
          );
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
          await this.safeguards.triggerVehicleSafeguardForAssignment(
            tx,
            dto.employeeId,
            user.id,
            {
              usageType,
              startDate,
              endDate,
              inspectionItems,
            },
          );
        }

        return vehicle;
      });
    } catch (error) {
      handleDatabaseErrors(error, 'VehicleItem');
    }
  }

  async update(id: string, dto: UpdateVehicleItemDto, user: AuthUser) {
    const vehicle = await this.validation.getVehicleOrThrow(id);
    assertBranchAccess(user, vehicle.currentBranchId);

    const effectiveOwnership = dto.ownershipType ?? vehicle.ownershipType;
    const effectiveFolio = dto.providerFolio ?? vehicle.providerFolio;
    if (effectiveOwnership === 'PROVIDER' && !effectiveFolio) {
      throw new BadRequestException(
        'providerFolio es obligatorio para vehículos con ownershipType PROVIDER',
      );
    }

    const {
      usageType: _usageType,
      startDate: _startDate,
      endDate: _endDate,
      inspectionItems: _inspectionItems,
      ...vehicleFields
    } = dto;

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
}
