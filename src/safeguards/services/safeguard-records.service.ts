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
  SAFEGUARD_ALLOWED_FIELDS,
  SAFEGUARD_INCLUDE,
} from '../constants/safeguard-query.const';
import { CreateSafeguardDto } from '../dto/create-safeguard.dto';
import { FindSafeguardsDto } from '../dto/find-safeguards.dto';
import { SafeguardWithDetails } from '../types/safeguard.types';
import { SafeguardGenerationService } from './safeguard-generation.service';

/** Create on demand, list, detail and delete safeguards of the user's branches. */
@Injectable()
export class SafeguardRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly generation: SafeguardGenerationService,
  ) {}

  async create(
    dto: CreateSafeguardDto,
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
        this.generation.createFromEmployeeDevices(tx, dto.employeeId, {
          usageType: dto.usageType,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          endDate: dto.endDate ? new Date(dto.endDate) : undefined,
          createdByUserId: user.id,
          mobileAccessories: dto.mobileAccessories,
        }),
      );
    } catch (error) {
      handleDatabaseErrors(error, 'Safeguard');
    }
  }

  async findAll(dto: FindSafeguardsDto, user: BranchScopedUser) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['employeeName', 'area'],
      defaultSort: { createdAt: 'desc' },
      allowedFields: SAFEGUARD_ALLOWED_FIELDS,
    });

    const finalWhere = {
      ...where,
      ...userBranchFilter(user, dto.branchId),
      ...(dto.employeeId && { employeeId: dto.employeeId }),
      ...(!dto.includeHistory && { supersededAt: null }),
    } as Prisma.SafeguardWhereInput;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.safeguard.findMany({
        skip,
        take,
        where: finalWhere,
        orderBy,
        include: SAFEGUARD_INCLUDE,
      }),
      this.prisma.safeguard.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOne(
    id: string,
    user: BranchScopedUser,
  ): Promise<SafeguardWithDetails> {
    const safeguard = await this.prisma.safeguard.findUnique({
      where: { id },
      include: SAFEGUARD_INCLUDE,
    });
    if (!safeguard) {
      throw new NotFoundException(`Safeguard with ID '${id}' not found`);
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
      return await this.prisma.safeguard.delete({ where: { id } });
    } catch (error) {
      handleDatabaseErrors(error, 'Safeguard');
    }
  }
}
