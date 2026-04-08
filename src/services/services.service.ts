import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { generateSlug } from 'src/common/utils/slugger.util';

@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createServiceDto: CreateServiceDto) {
    const { benefits, details, ...serviceData } = createServiceDto;
    const slug = generateSlug(serviceData.name);

    return this.prisma.service.create({
      data: {
        ...serviceData,
        slug,
        benefits: benefits ? { create: benefits } : undefined,
        details: details ? { create: details } : undefined,
      },
      include: {
        benefits: true,
        details: true,
      },
    });
  }

  async findAll() {
    return await this.prisma.service.findMany({
      where: {
        isActive: true,
      },
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

  async findOne(id: string) {
    const service = await this.prisma.service.findFirst({
      where: {
        OR: [{ id }, { slug: id }],
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

    const { benefits, details, ...serviceData } = updateServiceDto;

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
