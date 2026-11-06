import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
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
import {
  VEHICLE_SAFEGUARD_ALLOWED_FIELDS,
  VEHICLE_SAFEGUARD_INCLUDE,
} from '../constants/vehicle-safeguard-query.const';
import { CreateVehicleSafeguardDto } from '../dto/create-vehicle-safeguard.dto';
import { FindVehicleSafeguardsDto } from '../dto/find-vehicle-safeguards.dto';
import { VehicleSafeguardWithDetails } from '../types/vehicle-safeguard.types';
import { VehicleSafeguardGenerationService } from './vehicle-safeguard-generation.service';

/** Create on demand, list, detail and delete vehicle safeguards of the user's branches. */
@Injectable()
export class VehicleSafeguardRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly generation: VehicleSafeguardGenerationService,
  ) {}

  async create(
    dto: CreateVehicleSafeguardDto,
    user: BranchScopedUser & { id: string },
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
    });
    if (!employee) {
      throw new NotFoundException(
        `Employee with ID '${dto.employeeId}' not found`,
      );
    }
    assertBranchAccess(user, employee.branchId);

    try {
      return await this.prisma.$transaction((tx) =>
        this.generation.createFromEmployeeVehicle(tx, dto.employeeId, {
          usageType: dto.usageType,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          endDate: dto.endDate ? new Date(dto.endDate) : undefined,
          createdByUserId: user.id,
          inspectionItems: dto.inspectionItems,
        }),
      );
    } catch (error) {
      handleDatabaseErrors(error, 'VehicleSafeguard');
    }
  }

  async findAll(dto: FindVehicleSafeguardsDto, user: BranchScopedUser) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['employeeName', 'area'],
      defaultSort: { createdAt: 'desc' },
      allowedFields: VEHICLE_SAFEGUARD_ALLOWED_FIELDS,
    });

    const finalWhere = {
      ...where,
      ...userBranchFilter(user, dto.branchId),
      ...(dto.employeeId && { employeeId: dto.employeeId }),
      ...(!dto.includeHistory && { supersededAt: null }),
    } as Prisma.VehicleSafeguardWhereInput;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.vehicleSafeguard.findMany({
        skip,
        take,
        where: finalWhere,
        orderBy,
        include: VEHICLE_SAFEGUARD_INCLUDE,
      }),
      this.prisma.vehicleSafeguard.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOne(
    id: string,
    user: BranchScopedUser,
  ): Promise<VehicleSafeguardWithDetails> {
    const safeguard = await this.prisma.vehicleSafeguard.findUnique({
      where: { id },
      include: VEHICLE_SAFEGUARD_INCLUDE,
    });
    if (!safeguard) {
      throw new NotFoundException(`VehicleSafeguard with ID '${id}' not found`);
    }
    assertBranchAccess(user, safeguard.branchId);

    return safeguard;
  }

  async remove(id: string, user: BranchScopedUser) {
    const safeguard = await this.findOne(id, user);

    if (safeguard.supersededAt) {
      throw new BadRequestException(
        'No se pueden eliminar versiones históricas del resguardo; solo la vigente.',
      );
    }

    try {
      return await this.prisma.vehicleSafeguard.delete({ where: { id } });
    } catch (error) {
      handleDatabaseErrors(error, 'VehicleSafeguard');
    }
  }
}
