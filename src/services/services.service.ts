import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { generateSlug } from 'src/common/utils/slugger.util';
import { BranchesService } from 'src/branches/branches.service';
import { branchScopeWhere } from 'src/common/utils/branch-scope.util';
import { Prisma } from '@prisma/client';

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchesService: BranchesService,
  ) {}

  async create(createServiceDto: CreateServiceDto) {
    const { benefits, details, branchIds, ...serviceData } = createServiceDto;
    const slug = generateSlug(serviceData.name);

    return this.prisma.service.create({
      data: {
        ...serviceData,
        slug,
        benefits: benefits ? { create: benefits } : undefined,
        details: details ? { create: details } : undefined,
        ...(branchIds?.length && {
          branches: { connect: branchIds.map((id) => ({ id })) },
        }),
      },
      include: {
        benefits: true,
        details: true,
      },
    });
  }

  async findAll(branchId?: string) {
    if (branchId) {
      return this.findAllByBranch(branchId);
    }

    return await this.prisma.service.findMany({
      where: {
        isActive: true,
        ...branchScopeWhere(branchId),
      } as Prisma.ServiceWhereInput,
      include: {
        benefits: true,
        details: true,
        _count: {
          select: { studies: true },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  private async findAllByBranch(branchId: string) {
    const activePriceSheetId =
      await this.branchesService.resolveBranchPriceSheetId(branchId);

    if (activePriceSheetId === null) {
      throw new NotFoundException(
        `La sucursal con id ${branchId} no existe o no tiene una hoja de precios asignada.`,
      );
    }

    const services = await this.prisma.service.findMany({
      where: {
        isActive: true,
        ...branchScopeWhere(branchId),
      } as Prisma.ServiceWhereInput,
      include: {
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
      orderBy: { name: 'asc' },
    });

    return services.map((service) => ({
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
  }

  async findOne(id: string, branchId?: string) {
    if (branchId) {
      await this.branchesService.findOne(branchId);
    }

    const service = await this.prisma.service.findFirst({
      where: {
        AND: [
          { OR: [{ id }, { slug: id }] },
          branchScopeWhere(branchId) as Prisma.ServiceWhereInput,
        ],
      },
      include: {
        benefits: true,
        details: true,
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

    const { benefits, details, branchIds, ...serviceData } = updateServiceDto;

    const existingService = await this.prisma.service.findUnique({
      where: { id },
    });
    if (!existingService) throw new NotFoundException('Servicio no encontrado');

    if (serviceData.name) {
      serviceData['slug'] = generateSlug(serviceData.name);
    }

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
          ...(branchIds !== undefined && {
            branches: { set: branchIds.map((id) => ({ id })) },
          }),
        },
        include: {
          benefits: true,
          details: true,
        },
      });
    });
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
