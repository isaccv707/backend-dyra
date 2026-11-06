import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { BranchesService } from 'src/branches/branches.service';
import {
  buildPaginatedQuery,
  paginatedResponse,
} from 'src/common/utils/paginate.util';
import { studyTitle } from 'src/studies/utils/study-title.util';
import {
  PUBLIC_PRICE_SHEET_WHERE,
  SERVICE_ALLOWED_FIELDS,
} from '../constants/service-query.const';
import { FindServicesDto } from '../dto/find-services.dto';

/** Public reads: active services and only the studies priced in public sheets. */
@Injectable()
export class ServicePublicQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchesService: BranchesService,
  ) {}

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
    const { priceSheetId, isPanel } = dto;

    let overridePriceSheetId: string | undefined;
    if (priceSheetId) {
      const priceSheet = await this.prisma.priceSheets.findFirst({
        where: { id: priceSheetId, branchId, ...PUBLIC_PRICE_SHEET_WHERE },
        select: { id: true },
      });
      if (!priceSheet) {
        throw new NotFoundException(
          `La hoja de precios ${priceSheetId} no pertenece a la sucursal ${branchId}.`,
        );
      }
      overridePriceSheetId = priceSheet.id;
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
            where: {
              isActive: true,
              ...(isPanel !== undefined && { isPanel }),
            },
            orderBy: { name: 'asc' },
            select: {
              id: true,
              name: true,
              title: true,
              slug: true,
              code: true,
              isPanel: true,
              description: true,
              sampleType: { select: { name: true } },
              deliveryTime: true,
              preparation: true,
            },
          },
        },
      }),
      this.prisma.service.count({ where: whereClause }),
    ]);

    const priceSheetIdsToResolve = overridePriceSheetId
      ? [overridePriceSheetId]
      : [
          ...new Set(
            services
              .map((s) => s.priceSheetId)
              .filter((id): id is string => !!id),
          ),
        ];

    const priceEntries = priceSheetIdsToResolve.length
      ? await this.prisma.studyOnPriceSheet.findMany({
          where: {
            priceSheetId: { in: priceSheetIdsToResolve },
            priceSheet: PUBLIC_PRICE_SHEET_WHERE,
            studyId: {
              in: services.flatMap((s) => s.studies.map((st) => st.id)),
            },
          },
        })
      : [];

    const priceByKey = new Map(
      priceEntries.map((entry) => [
        `${entry.studyId}:${entry.priceSheetId}`,
        entry,
      ]),
    );

    const data = services.map((service) => {
      const effectivePriceSheetId =
        overridePriceSheetId ?? service.priceSheetId ?? undefined;

      // Only studies priced in the effective sheet are sellable; panel-only
      // parameters have no price and are hidden.
      const pricedStudies = effectivePriceSheetId
        ? service.studies.flatMap((study) => {
            const regionalPrice = priceByKey.get(
              `${study.id}:${effectivePriceSheetId}`,
            );
            return regionalPrice ? [{ study, regionalPrice }] : [];
          })
        : [];

      return {
        ...service,
        _count: { studies: pricedStudies.length },
        studies: pricedStudies.map(({ study, regionalPrice }) => {
          return {
            id: study.id,
            name: study.name,
            title: studyTitle(study),
            slug: study.slug,
            code: study.code,
            isPanel: study.isPanel,
            description: study.description,
            sampleType: study.sampleType?.name ?? null,
            deliveryTime: study.deliveryTime,
            preparation: study.preparation,
            priceInfo: {
              showPrice: regionalPrice.showPrice,
              price: regionalPrice.showPrice ? regionalPrice.price : null,
              message: regionalPrice.showPrice
                ? null
                : 'Para mayor información consulte en sucursal',
            },
          };
        }),
      };
    });

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOne(id: string, dto: FindServicesDto = {}) {
    const { branchId, page = 1, limit = 10, search, isPanel } = dto;

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
        priceSheet: {
          select: {
            id: true,
            name: true,
            description: true,
            isPublic: true,
            isActive: true,
          },
        },
        _count: {
          select: { studies: true },
        },
      },
    });
    if (!service)
      throw new NotFoundException(`The Service with id: ${id} not found`);

    const skip = (page - 1) * limit;
    const term = search?.trim();
    const { priceSheet: assignedSheet, ...serviceData } = service;
    const priceSheet =
      assignedSheet?.isPublic && assignedSheet.isActive
        ? {
            id: assignedSheet.id,
            name: assignedSheet.name,
            description: assignedSheet.description,
          }
        : null;

    if (!priceSheet) {
      return {
        ...serviceData,
        priceSheet,
        studies: paginatedResponse([], 0, page, limit),
      };
    }

    // Only studies priced in the service's sheet are sellable; panel-only
    // parameters have no price and are hidden.
    const studiesWhere: Prisma.StudyWhereInput = {
      serviceId: service.id,
      isActive: true,
      priceSheets: {
        some: {
          priceSheetId: priceSheet.id,
        },
      },
      ...(isPanel !== undefined && { isPanel }),
      ...(term && {
        OR: [
          { name: { contains: term, mode: Prisma.QueryMode.insensitive } },
          { code: { contains: term, mode: Prisma.QueryMode.insensitive } },
        ],
      }),
    };

    const [studies, studiesTotal] = await this.prisma.$transaction([
      this.prisma.study.findMany({
        where: studiesWhere,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          code: true,
          slug: true,
          isPanel: true,
          description: true,
          preparation: true,
          sampleType: { select: { name: true } },
          section: { select: { name: true } },
        },
      }),
      this.prisma.study.count({ where: studiesWhere }),
    ]);

    const priceEntries = await this.prisma.studyOnPriceSheet.findMany({
      where: {
        priceSheetId: priceSheet.id,
        studyId: { in: studies.map((s) => s.id) },
      },
    });

    const priceByStudyId = new Map(
      priceEntries.map((entry) => [entry.studyId, entry]),
    );

    return {
      ...serviceData,
      priceSheet,
      studies: paginatedResponse(
        studies.map((study) => {
          const regionalPrice = priceByStudyId.get(study.id);
          return {
            ...study,
            sampleType: study.sampleType?.name ?? null,
            section: study.section?.name ?? null,
            priceInfo: {
              showPrice: regionalPrice?.showPrice ?? false,
              price: regionalPrice?.showPrice ? regionalPrice.price : null,
              message: regionalPrice?.showPrice
                ? null
                : 'Para mayor información consulte en sucursal',
            },
          };
        }),
        studiesTotal,
        page,
        limit,
      ),
    };
  }
}
