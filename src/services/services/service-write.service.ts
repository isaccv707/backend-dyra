import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { generateSlug } from 'src/common/utils/slugger.util';
import { CreateServiceDto } from '../dto/create-service.dto';
import { UpdateServiceDto } from '../dto/update-service.dto';

/** Creates, edits and deletes services, and checks their price sheet. */
@Injectable()
export class ServiceWriteService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertPriceSheetIsEligible(
    priceSheetId: string,
    branchId: string,
  ) {
    const priceSheet = await this.prisma.priceSheets.findUnique({
      where: { id: priceSheetId },
      select: { branchId: true, isPublic: true },
    });
    if (!priceSheet) {
      throw new NotFoundException(
        `PriceSheet with id ${priceSheetId} not found`,
      );
    }
    if (priceSheet.branchId !== branchId) {
      throw new BadRequestException(
        'La hoja de precios pertenece a otra sucursal distinta a la del servicio',
      );
    }
    if (!priceSheet.isPublic) {
      throw new BadRequestException(
        'Solo se puede asignar a un servicio una hoja de precios marcada como pública (isPublic=true)',
      );
    }
  }

  async create(createServiceDto: CreateServiceDto) {
    const { benefits, details, branchId, priceSheetId, ...serviceData } =
      createServiceDto;
    const slug = generateSlug(serviceData.name);

    if (priceSheetId) {
      await this.assertPriceSheetIsEligible(priceSheetId, branchId);
    }

    try {
      return await this.prisma.service.create({
        data: {
          ...serviceData,
          slug,
          benefits: benefits ? { create: benefits } : undefined,
          details: details ? { create: details } : undefined,
          branch: { connect: { id: branchId } },
          ...(priceSheetId && {
            priceSheet: { connect: { id: priceSheetId } },
          }),
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

  async update(id: string, updateServiceDto: UpdateServiceDto) {
    if (!updateServiceDto) return;

    const { benefits, details, branchId, priceSheetId, ...serviceData } =
      updateServiceDto;

    const existingService = await this.prisma.service.findUnique({
      where: { id },
    });
    if (!existingService) throw new NotFoundException('Servicio no encontrado');

    if (serviceData.name) {
      serviceData['slug'] = generateSlug(serviceData.name);
    }

    if (priceSheetId) {
      await this.assertPriceSheetIsEligible(
        priceSheetId,
        branchId ?? existingService.branchId,
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
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
            benefits:
              benefits && benefits.length > 0
                ? { create: benefits }
                : undefined,
            details:
              details && details.length > 0 ? { create: details } : undefined,
            ...(branchId !== undefined && {
              branch: { connect: { id: branchId } },
            }),
            ...(priceSheetId !== undefined && {
              priceSheet: priceSheetId
                ? { connect: { id: priceSheetId } }
                : { disconnect: true },
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
    const service = await this.prisma.service.findUnique({
      where: { id },
      include: { _count: { select: { studies: true } } },
    });
    if (!service)
      throw new NotFoundException(`The service with id: ${id} not found`);

    // Study.service has no cascade: a service with studies (active or not,
    // priced or not) can't be deleted.
    if (service._count.studies > 0) {
      throw new ConflictException(
        `No se puede eliminar el servicio "${service.name}" porque tiene ${service._count.studies} estudio(s) asociado(s). Reasígnalos a otro servicio o desactiva el servicio.`,
      );
    }

    await this.prisma.service.delete({
      where: { id },
    });
    return {
      message: `The service "${service.name}" and its related data have been deleted.`,
      deletedId: id,
    };
  }
}
