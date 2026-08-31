import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateVehicleCatalogDto } from './dto/create-vehicle-catalog.dto';
import { UpdateVehicleCatalogDto } from './dto/update-vehicle-catalog.dto';
import { FindVehicleCatalogDto } from './dto/find-vehicle-catalog.dto';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { buildPaginatedQuery, paginatedResponse } from 'src/common/utils/paginate.util';

const VEHICLE_CATALOG_ALLOWED_FIELDS = ['name', 'brand', 'model', 'isActive', 'createdAt'];

@Injectable()
export class VehicleCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createVehicleCatalogDto: CreateVehicleCatalogDto) {
    try {
      return await this.prisma.vehicleCatalog.create({ data: createVehicleCatalogDto });
    } catch (error) {
      handleDatabaseErrors(error, 'VehicleCatalog');
    }
  }

  async findAll(dto: FindVehicleCatalogDto) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['name', 'brand', 'model'],
      defaultSort: { createdAt: 'desc' },
      allowedFields: VEHICLE_CATALOG_ALLOWED_FIELDS,
    });

    const finalWhere = {
      ...where,
      ...(!dto.includeInactive && { isActive: true }),
    } as Prisma.VehicleCatalogWhereInput;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.vehicleCatalog.findMany({ skip, take, where: finalWhere, orderBy }),
      this.prisma.vehicleCatalog.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOne(id: string) {
    const catalog = await this.prisma.vehicleCatalog.findUnique({ where: { id } });
    if (!catalog) {
      throw new NotFoundException(`VehicleCatalog with ID '${id}' not found`);
    }
    return catalog;
  }

  async update(id: string, updateVehicleCatalogDto: UpdateVehicleCatalogDto) {
    await this.findOne(id);

    try {
      return await this.prisma.vehicleCatalog.update({ where: { id }, data: updateVehicleCatalogDto });
    } catch (error) {
      handleDatabaseErrors(error, 'VehicleCatalog');
    }
  }

  async remove(id: string) {
    await this.findOne(id);

    // Chequeo explícito (con mensaje claro para la UI) en vez de dejar que
    // truene el FK constraint: un modelo de catálogo solo se puede eliminar
    // si ningún VehicleItem lo referencia.
    const itemCount = await this.prisma.vehicleItem.count({ where: { catalogId: id } });
    if (itemCount > 0) {
      throw new BadRequestException(
        `No se puede eliminar: existen ${itemCount} vehículo(s) dado(s) de alta con este modelo de catálogo. ` +
          'Puede archivarlo en su lugar (PATCH con isActive: false) para ocultarlo del listado sin perder el historial.',
      );
    }

    try {
      return await this.prisma.vehicleCatalog.delete({ where: { id } });
    } catch (error) {
      handleDatabaseErrors(error, 'VehicleCatalog');
    }
  }
}
