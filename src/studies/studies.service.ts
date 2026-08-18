import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { CreateStudyDto } from './dto/create-study.dto';
import { UpdateStudyDto } from './dto/update-study.dto';
import { AssignPriceSheetDto } from './dto/assign-price-sheet.dto';
import { PaginationDto } from './dto/pagination-study.dto';
import { Prisma } from '@prisma/client';
import { generateSlug } from 'src/common/utils/slugger.util';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { buildPaginatedQuery, paginatedResponse } from 'src/common/utils/paginate.util';

const STUDY_ALLOWED_FIELDS = ['name', 'code', 'isActive', 'deliveryTime', 'createdAt'];

@Injectable()
export class StudiesService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertServiceBelongsToBranch(serviceId: string, branchId: string) {
    const service = await this.prisma.service.findUnique({
      where: { id: serviceId },
      select: { branchId: true },
    });
    if (!service) {
      throw new NotFoundException(`Service with id ${serviceId} not found`);
    }
    if (service.branchId !== branchId) {
      throw new BadRequestException(
        'El servicio seleccionado pertenece a otra sucursal',
      );
    }
  }

  private async assertPriceSheetsBelongToBranch(priceSheetIds: string[], branchId: string) {
    if (!priceSheetIds.length) return;

    const priceSheets = await this.prisma.priceSheets.findMany({
      where: { id: { in: priceSheetIds } },
      select: { id: true, branchId: true },
    });

    const foreign = priceSheets.find((ps) => ps.branchId !== branchId);
    if (foreign || priceSheets.length !== priceSheetIds.length) {
      throw new BadRequestException(
        'Todos los tarifarios asignados deben pertenecer a la misma sucursal del estudio',
      );
    }
  }

  async create(createStudyDto: CreateStudyDto) {
    const { name, studyPrices, serviceId, branchId, ...studyData } = createStudyDto;
    const slug = generateSlug(name);

    await this.assertServiceBelongsToBranch(serviceId, branchId);
    if (studyPrices?.length) {
      await this.assertPriceSheetsBelongToBranch(
        studyPrices.map((p) => p.priceSheetId),
        branchId,
      );
    }

    try {
      return await this.prisma.study.create({
        data: {
          ...studyData,
          service: {
            connect: { id: serviceId },
          },
          branch: {
            connect: { id: branchId },
          },
          name,
          slug,
          ...(studyPrices?.length && {
            priceSheets: {
              create: studyPrices.map((p) => ({
                price: new Prisma.Decimal(p.price),
                showPrice: p.showPrice ?? true,
                priceSheetId: p.priceSheetId,
              })),
            },
          }),
        },
        include: {
          service: {
            select: { name: true, slug: true },
          },
          priceSheets: true,
        },
      });
    } catch (error: any) {
      console.log(error);
      handleDatabaseErrors(error, 'Study');
    }
  }

  async findAll(dto: PaginationDto) {
    const { priceSheetId, branchId } = dto;
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['name', 'code'],
      defaultSort: { name: 'asc' },
      allowedFields: STUDY_ALLOWED_FIELDS,
      minSearchLength: 2,
    });

    const whereClause: Prisma.StudyWhereInput = {
      ...(where as Prisma.StudyWhereInput),
      ...(branchId && { branchId }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.study.findMany({
        skip,
        take,
        where: whereClause,
        orderBy,
        include: {
          // Con branchId cada estudio muestra el precio de la hoja pública de
          // SU PROPIO servicio (Service.priceSheetId), no una hoja única
          // compartida por toda la sucursal. Sin branchId se usa el
          // priceSheetId explícito (vista admin de un tarifario puntual).
          service: { select: { priceSheetId: true } },
        },
      }),
      this.prisma.study.count({ where: whereClause }),
    ]);

    const priceSheetIdsToResolve = branchId
      ? [...new Set(items.map((s) => s.service.priceSheetId).filter((id): id is string => !!id))]
      : priceSheetId
        ? [priceSheetId]
        : [];

    const priceEntries = priceSheetIdsToResolve.length
      ? await this.prisma.studyOnPriceSheet.findMany({
          where: {
            priceSheetId: { in: priceSheetIdsToResolve },
            studyId: { in: items.map((s) => s.id) },
          },
        })
      : [];

    const priceByKey = new Map(
      priceEntries.map((entry) => [`${entry.studyId}:${entry.priceSheetId}`, entry]),
    );

    const data = items.map((study) => {
      const { service, ...rest } = study;
      const effectivePriceSheetId = branchId ? service.priceSheetId : priceSheetId;
      const regionalPrice = effectivePriceSheetId
        ? priceByKey.get(`${study.id}:${effectivePriceSheetId}`)
        : undefined;

      return {
        ...rest,
        priceInfo: {
          showPrice: regionalPrice?.showPrice ?? false,
          price: regionalPrice?.showPrice ? regionalPrice.price : null,
          message: regionalPrice?.showPrice
            ? null
            : 'Para mayor información consulte en sucursal',
          // Agregamos esto para debug o por si el estado no tiene precio cargado
          hasConfiguredPrice: !!regionalPrice,
        },
      };
    });

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOne(id: string, branchId?: string) {
    const study = await this.prisma.study.findFirst({
      where: {
        OR: [{ id }, { slug: id }],
        ...(branchId && { branchId }),
      },
      include: {
        priceSheets: {
          include: {
            priceSheet: true,
          },
        },
        service: true,
      },
    });
    if (!study) {
      throw new NotFoundException(`Study with id ${id} not found`);
    }
    return study;
  }

  async update(id: string, updateStudyDto: UpdateStudyDto) {
    const { name, serviceId, branchId, ...studyData } = updateStudyDto;

    const existingStudy = await this.prisma.study.findUnique({
      where: { id },
    });
    if (!existingStudy) {
      throw new NotFoundException(`Study with id ${id} not found`);
    }

    const effectiveBranchId = branchId ?? existingStudy.branchId;
    const effectiveServiceId = serviceId ?? existingStudy.serviceId;
    if (branchId || serviceId) {
      await this.assertServiceBelongsToBranch(effectiveServiceId, effectiveBranchId);
    }

    try {
      return await this.prisma.study.update({
        where: { id },
        data: {
          ...studyData,
          ...(name && { name, slug: generateSlug(name) }),
          ...(serviceId && { service: { connect: { id: serviceId } } }),
          ...(branchId && { branch: { connect: { id: branchId } } }),
        },
        include: {
          service: {
            select: { name: true, slug: true },
          },
          priceSheets: true,
        },
      });
    } catch (error) {
      handleDatabaseErrors(error, 'Study');
    }
  }

  async assignPriceSheet(studyId: string, dto: AssignPriceSheetDto) {
    const study = await this.prisma.study.findUnique({
      where: { id: studyId },
    });
    if (!study) {
      throw new NotFoundException(`Study with id ${studyId} not found`);
    }

    const priceSheet = await this.prisma.priceSheets.findUnique({
      where: { id: dto.priceSheetId },
    });
    if (!priceSheet) {
      throw new NotFoundException(
        `PriceSheet with id ${dto.priceSheetId} not found`,
      );
    }
    if (priceSheet.branchId !== study.branchId) {
      throw new BadRequestException(
        'El tarifario pertenece a otra sucursal distinta a la del estudio',
      );
    }

    try {
      return await this.prisma.studyOnPriceSheet.upsert({
        where: {
          studyId_priceSheetId: {
            studyId,
            priceSheetId: dto.priceSheetId,
          },
        },
        update: {
          price: new Prisma.Decimal(dto.price),
          showPrice: dto.showPrice ?? true,
        },
        create: {
          studyId,
          priceSheetId: dto.priceSheetId,
          price: new Prisma.Decimal(dto.price),
          showPrice: dto.showPrice ?? true,
        },
        include: { priceSheet: true },
      });
    } catch (error) {
      handleDatabaseErrors(error, 'Study');
    }
  }

  async removePriceSheet(studyId: string, priceSheetId: string) {
    const assignment = await this.prisma.studyOnPriceSheet.findUnique({
      where: { studyId_priceSheetId: { studyId, priceSheetId } },
    });
    if (!assignment) {
      throw new NotFoundException(
        `Study ${studyId} has no price assigned for PriceSheet ${priceSheetId}`,
      );
    }

    try {
      return await this.prisma.studyOnPriceSheet.delete({
        where: { studyId_priceSheetId: { studyId, priceSheetId } },
      });
    } catch (error) {
      handleDatabaseErrors(error, 'Study');
    }
  }

  async remove(id: string) {
    const existingStudy = await this.prisma.study.findUnique({
      where: { id },
    });
    if (!existingStudy) {
      throw new NotFoundException(`Study with id ${id} not found`);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.studyOnPriceSheet.deleteMany({ where: { studyId: id } });
        return tx.study.delete({ where: { id } });
      });
    } catch (error) {
      handleDatabaseErrors(error, 'Study');
    }
  }

}
