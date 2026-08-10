import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateDeviceCatalogDto } from './dto/create-device-catalog.dto';
import { UpdateDeviceCatalogDto } from './dto/update-device-catalog.dto';
import { FindDeviceCatalogDto } from './dto/find-device-catalog.dto';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { buildPaginatedQuery, paginatedResponse } from 'src/common/utils/paginate.util';

const DEVICE_CATALOG_ALLOWED_FIELDS = ['name', 'brand', 'model', 'type', 'createdAt'];

@Injectable()
export class DeviceCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createDeviceCatalogDto: CreateDeviceCatalogDto) {
    try {
      return await this.prisma.deviceCatalog.create({ data: createDeviceCatalogDto });
    } catch (error) {
      handleDatabaseErrors(error, 'DeviceCatalog');
    }
  }

  async findAll(dto: FindDeviceCatalogDto) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['name', 'brand', 'model'],
      defaultSort: { createdAt: 'desc' },
      allowedFields: DEVICE_CATALOG_ALLOWED_FIELDS,
    });

    const finalWhere = {
      ...where,
      ...(dto.type && { type: dto.type }),
    } as Prisma.DeviceCatalogWhereInput;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.deviceCatalog.findMany({ skip, take, where: finalWhere, orderBy }),
      this.prisma.deviceCatalog.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOne(id: string) {
    const catalog = await this.prisma.deviceCatalog.findUnique({ where: { id } });

    if (!catalog) {
      throw new NotFoundException(`DeviceCatalog with ID '${id}' not found`);
    }

    return catalog;
  }

  async update(id: string, updateDeviceCatalogDto: UpdateDeviceCatalogDto) {
    await this.findOne(id);

    try {
      return await this.prisma.deviceCatalog.update({
        where: { id },
        data: updateDeviceCatalogDto,
      });
    } catch (error) {
      handleDatabaseErrors(error, 'DeviceCatalog');
    }
  }

  async remove(id: string) {
    await this.findOne(id);

    try {
      return await this.prisma.deviceCatalog.delete({ where: { id } });
    } catch (error) {
      handleDatabaseErrors(error, 'DeviceCatalog');
    }
  }
}
