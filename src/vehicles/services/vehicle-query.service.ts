import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import {
  BranchScopedUser,
  userBranchFilter,
} from 'src/common/utils/branch-access.util';
import {
  buildPaginatedQuery,
  paginatedResponse,
} from 'src/common/utils/paginate.util';
import {
  VEHICLE_ALLOWED_FIELDS,
  VEHICLE_INCLUDE,
} from '../constants/vehicle-includes.const';
import { FindVehiclesDto } from '../dto/find-vehicles.dto';
import { FindVehicleMovementHistoryDto } from '../dto/find-vehicle-movement-history.dto';
import { VehicleValidationService } from './vehicle-validation.service';

/** Reads of vehicles and their movement history. */
@Injectable()
export class VehicleQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validation: VehicleValidationService,
  ) {}

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
      this.prisma.vehicleItem.findMany({
        skip,
        take,
        where: finalWhere,
        orderBy,
        include: VEHICLE_INCLUDE,
      }),
      this.prisma.vehicleItem.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOne(id: string) {
    const vehicle = await this.prisma.vehicleItem.findUnique({
      where: { id },
      include: VEHICLE_INCLUDE,
    });
    if (!vehicle) {
      throw new NotFoundException(`VehicleItem with ID '${id}' not found`);
    }
    return vehicle;
  }

  async findMovementHistory(
    vehicleId: string,
    dto: FindVehicleMovementHistoryDto,
  ) {
    await this.validation.getVehicleOrThrow(vehicleId);

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

  private branchScopedWhere(user: BranchScopedUser, branchId?: string) {
    const { branchId: condition } = userBranchFilter(user, branchId) as {
      branchId?: unknown;
    };
    return condition !== undefined ? { currentBranchId: condition } : {};
  }
}
