import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { FindServicesDto } from './dto/find-services.dto';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { generateSlug } from 'src/common/utils/slugger.util';
import { BranchesService } from 'src/branches/branches.service';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import {
  buildPaginatedQuery,
  paginatedResponse,
} from 'src/common/utils/paginate.util';
import { Prisma } from '@prisma/client';

const SERVICE_ALLOWED_FIELDS = ['name', 'createdAt'];

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchesService: BranchesService,
  ) {}

  async create(createServiceDto: CreateServiceDto) {
    const { benefits, details, branchId, ...serviceData } = createServiceDto;
    const slug = generateSlug(serviceData.name);

    try {
      return await this.prisma.service.create({
        data: {
          ...serviceData,
          slug,
          benefits: benefits ? { create: benefits } : undefined,
          details: details ? { create: details } : undefined,
          branch: { connect: { id: branchId } },
        },
        include: {
          benefits: true,
          details: true,
        },
      });
    } catch (error) {
      handleDatabaseErrors(error, 'Service');
    }
  }

  async findAll(dto: FindServicesDto) {
    if (dto.branchId) {
      return this.findAllByBranch(dto.branchId, dto);
    }

    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['name', 'description'],
      allowedFields: SERVICE_ALLOWED_FIELDS,
      defaultSort: { name: 'asc' },
    });

    const whereClause: Prisma.ServiceWhereInput = {
      AND: [where, { isActive: true }],
    };

    const [services, total] = await this.prisma.$transaction([
      this.prisma.service.findMany({
        where: whereClause,
        skip,
        take,
        orderBy,
        include: {
          benefits: true,
          details: true,
          branch: true,
          _count: {
            select: { studies: true },
          },
        },
      }),
      this.prisma.service.count({ where: whereClause }),
    ]);

    return paginatedResponse(services, total, dto.page ?? 1, dto.limit ?? 10);
  }

  private async findAllByBranch(branchId: string, dto: FindServicesDto) {
    const { priceSheetId } = dto;
    const activePriceSheetId = priceSheetId
      ? (
          await this.prisma.priceSheets.findFirst({
            where: { id: priceSheetId, branchId, isActive: true },
            select: { id: true },
          })
        )?.id
      : await this.branchesService.resolveBranchPriceSheetId(branchId);

    if (!activePriceSheetId) {
      throw new NotFoundException(
        priceSheetId
          ? `La hoja de precios ${priceSheetId} no pertenece a la sucursal ${branchId}.`
          : `La sucursal con id ${branchId} no existe o no tiene una hoja de precios asignada.`,
      );
    }

    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['name', 'description'],
      allowedFields: SERVICE_ALLOWED_FIELDS,
      defaultSort: { name: 'asc' },
    });

    const whereClause: Prisma.ServiceWhereInput = {
      AND: [where, { isActive: true, branchId }],
    };

    const [services, total] = await this.prisma.$transaction([
      this.prisma.service.findMany({
        where: whereClause,
        skip,
        take,
        orderBy,
        include: {
          branch: true,
          benefits: true,
          details: true,
          _count: {
            select: { studies: true },
          },
          studies: {
            where: { isActive: true },
            include: {
              priceSheets: {
                where: { priceSheetId: activePriceSheetId },
              },
            },
          },
        },
      }),
      this.prisma.service.count({ where: whereClause }),
    ]);

    const data = services.map((service) => ({
      ...service,
      studies: service.studies.map((study) => {
        const regionalPrice = study.priceSheets[0];
        return {
          id: study.id,
          name: study.name,
          slug: study.slug,
          code: study.code,
          description: study.description,
          sampleType: study.sampleType,
          deliveryTime: study.deliveryTime,
          preparation: study.preparation,
          priceInfo: {
            showPrice: regionalPrice?.showPrice ?? false,
            price: regionalPrice?.showPrice ? regionalPrice.price : null,
            message: regionalPrice?.showPrice
              ? null
              : 'Para mayor información consulte en sucursal',
          },
        };
      }),
    }));

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOne(id: string, branchId?: string) {
    if (branchId) {
      await this.branchesService.findOne(branchId);
    }

    const service = await this.prisma.service.findFirst({
      where: {
        OR: [{ id }, { slug: id }],
        ...(branchId && { branchId }),
      },
      include: {
        benefits: true,
        details: true,
        branch: true,
        studies: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            code: true,
            slug: true,
            // No traemos 'preparation' o 'description' aquí para que la
            // respuesta no sea gigante si hay 500 estudios.
          },
        },
        _count: {
          select: { studies: true },
        },
      },
    });
    if (!service)
      throw new NotFoundException(`The Service with id: ${id} not found`);

    return service;
  }

  async update(id: string, updateServiceDto: UpdateServiceDto) {
    // 1. Verificación de existencia del DTO
    if (!updateServiceDto) return;

    const { benefits, details, branchId, ...serviceData } = updateServiceDto;

    const existingService = await this.prisma.service.findUnique({
      where: { id },
    });
    if (!existingService) throw new NotFoundException('Servicio no encontrado');

    if (serviceData.name) {
      serviceData['slug'] = generateSlug(serviceData.name);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Solo borramos si el usuario envió explícitamente el arreglo (aunque sea vacío)
        if (benefits !== undefined) {
          await tx.benefit.deleteMany({ where: { serviceId: id } });
        }
        if (details !== undefined) {
          await tx.serviceDetail.deleteMany({ where: { serviceId: id } });
        }

        return await tx.service.update({
          where: { id },
          data: {
            ...serviceData,
            // Solo creamos si el arreglo existe y tiene contenido
            benefits:
              benefits && benefits.length > 0 ? { create: benefits } : undefined,
            details:
              details && details.length > 0 ? { create: details } : undefined,
            ...(branchId !== undefined && {
              branch: { connect: { id: branchId } },
            }),
          },
          include: {
            benefits: true,
            details: true,
          },
        });
      });
    } catch (error) {
      handleDatabaseErrors(error, 'Service');
    }
  }

  async remove(id: string) {
    const service = await this.prisma.service.findUnique({ where: { id } });
    if (!service)
      throw new NotFoundException(`The service with id: ${id} not found`);

    await this.prisma.service.delete({
      where: { id },
    });
    return {
      message: `The service "${service.name}" and its related data have been deleted.`,
      deletedId: id,
    };
  }
}
