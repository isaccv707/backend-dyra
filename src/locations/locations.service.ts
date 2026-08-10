import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { FindLocationsDto } from './dto/find-locations.dto';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { buildPaginatedQuery, paginatedResponse } from 'src/common/utils/paginate.util';
import { assertBranchAccess, BranchScopedUser, userBranchFilter } from 'src/common/utils/branch-access.util';

const LOCATION_ALLOWED_FIELDS = ['name', 'createdAt'];

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createLocationDto: CreateLocationDto, user: BranchScopedUser) {
    assertBranchAccess(user, createLocationDto.branchId);

    const branch = await this.prisma.branch.findUnique({
      where: { id: createLocationDto.branchId },
    });
    if (!branch) {
      throw new NotFoundException(`Branch with ID '${createLocationDto.branchId}' not found`);
    }

    try {
      return await this.prisma.location.create({ data: createLocationDto });
    } catch (error) {
      handleDatabaseErrors(error, 'Location');
    }
  }

  async findAll(dto: FindLocationsDto, user: BranchScopedUser) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['name'],
      defaultSort: { createdAt: 'desc' },
      allowedFields: LOCATION_ALLOWED_FIELDS,
    });

    const finalWhere = {
      ...where,
      ...userBranchFilter(user, dto.branchId),
    } as Prisma.LocationWhereInput;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.location.findMany({ skip, take, where: finalWhere, orderBy }),
      this.prisma.location.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOne(id: string) {
    const location = await this.prisma.location.findUnique({ where: { id } });

    if (!location) {
      throw new NotFoundException(`Location with ID '${id}' not found`);
    }

    return location;
  }

  async update(id: string, updateLocationDto: UpdateLocationDto, user: BranchScopedUser) {
    const location = await this.findOne(id);
    assertBranchAccess(user, location.branchId);

    if (updateLocationDto.branchId) {
      assertBranchAccess(user, updateLocationDto.branchId);
    }

    try {
      return await this.prisma.location.update({
        where: { id },
        data: updateLocationDto,
      });
    } catch (error) {
      handleDatabaseErrors(error, 'Location');
    }
  }

  async remove(id: string, user: BranchScopedUser) {
    const location = await this.findOne(id);
    assertBranchAccess(user, location.branchId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Same reasoning as EmployeesService.remove(): SetNull won't touch
        // `status`, so it must be reset explicitly before the row is deleted.
        await tx.deviceItem.updateMany({
          where: { locationId: id },
          data: { locationId: null, status: 'AVAILABLE' },
        });

        return tx.location.delete({ where: { id } });
      });
    } catch (error) {
      handleDatabaseErrors(error, 'Location');
    }
  }
}
