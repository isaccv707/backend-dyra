import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { QueryFilterDto } from 'src/common/dto/paginated-query.dto';
import {
  assertBranchAccess,
  BranchScopedUser,
  userBranchFilter,
} from 'src/common/utils/branch-access.util';
import {
  buildPaginatedQuery,
  paginatedResponse,
} from 'src/common/utils/paginate.util';
import {
  CATALOG_INCLUDE,
  PUBLIC_PRICE_SHEET_WHERE,
  STUDY_ALLOWED_FIELDS,
  STUDY_DETAIL_INCLUDE,
  STUDY_PUBLIC_DETAIL_INCLUDE,
} from '../constants/study-includes.const';
import { PaginationDto } from '../dto/pagination-study.dto';
import {
  studyNotFound,
  toPriceInfo,
  toStudyResponse,
  withoutProviderInfo,
} from '../utils/study-mappers.util';

const ELIGIBLE_PATIENTS_PREFIX = 'eligiblePatients.';

const toColumnField = (field: string) =>
  field.startsWith(ELIGIBLE_PATIENTS_PREFIX)
    ? field.slice(ELIGIBLE_PATIENTS_PREFIX.length)
    : field;

function withColumnFields(dto: PaginationDto): PaginationDto {
  const mapFilters = (filters?: QueryFilterDto[]) =>
    filters?.map((filter) => ({
      ...filter,
      field: toColumnField(filter.field),
    }));

  return {
    ...dto,
    sort: dto.sort && { ...dto.sort, field: toColumnField(dto.sort.field) },
    filters: dto.filters && {
      or: mapFilters(dto.filters.or),
      and: mapFilters(dto.filters.and),
    },
  };
}

/** Public and admin reads of studies. */
@Injectable()
export class StudyQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(dto: PaginationDto) {
    await this.assertPublicPriceSheet(dto.priceSheetId);
    return this.findStudies(dto, { isActive: true }, true);
  }

  /** Admin list of active studies: keeps the outsourcing data hidden from public routes. */
  findAdminActive(dto: PaginationDto, user: BranchScopedUser) {
    return this.findStudies(
      dto,
      { isActive: true, ...userBranchFilter(user, dto.branchId) },
      false,
    );
  }

  findInactive(dto: PaginationDto, user: BranchScopedUser) {
    return this.findStudies(
      dto,
      {
        isActive: false,
        ...userBranchFilter(user, dto.branchId),
      },
      false,
    );
  }

  async findOrderable(dto: PaginationDto) {
    await this.assertPublicPriceSheet(dto.priceSheetId);
    return this.findStudies(
      dto,
      {
        isActive: true,
        priceSheets: {
          some: {
            priceSheet: PUBLIC_PRICE_SHEET_WHERE,
            ...(dto.priceSheetId && { priceSheetId: dto.priceSheetId }),
          },
        },
      },
      true,
    );
  }

  /**
   * Admin quotation wizard: like findOrderable, but private (partner) sheets
   * count too, since admin quotations accept any active sheet of the branch.
   */
  async findAdminOrderable(dto: PaginationDto, user: BranchScopedUser) {
    const branchWhere = userBranchFilter(user, dto.branchId);
    if (dto.priceSheetId) {
      const priceSheet = await this.prisma.priceSheets.findFirst({
        where: { id: dto.priceSheetId, isActive: true, ...branchWhere },
        select: { id: true },
      });
      if (!priceSheet) {
        throw new NotFoundException(
          `Lista de precios con el ID ${dto.priceSheetId} no encontrada`,
        );
      }
    }
    return this.findStudies(
      dto,
      {
        isActive: true,
        ...branchWhere,
        priceSheets: {
          some: {
            priceSheet: { isActive: true },
            ...(dto.priceSheetId && { priceSheetId: dto.priceSheetId }),
          },
        },
      },
      false,
    );
  }

  /** Public routes may only read prices from public, active sheets. */
  private async assertPublicPriceSheet(priceSheetId?: string) {
    if (!priceSheetId) return;
    const priceSheet = await this.prisma.priceSheets.findFirst({
      where: { id: priceSheetId, ...PUBLIC_PRICE_SHEET_WHERE },
      select: { id: true },
    });
    if (!priceSheet) {
      throw new NotFoundException(
        `Lista de precios con el ID ${priceSheetId} no encontrada`,
      );
    }
  }

  private async findStudies(
    dto: PaginationDto,
    extraWhere: Prisma.StudyWhereInput,
    publicOnly: boolean,
  ) {
    const {
      priceSheetId,
      branchId,
      isPanel,
      isInternal,
      providerId,
      sectionId,
      sampleTypeId,
      techniqueId,
      gender,
      ageFormat,
      minAge,
      maxAge,
    } = dto;
    const { skip, take, where, orderBy } = buildPaginatedQuery(
      withColumnFields(dto),
      {
        searchFields: ['name', 'title', 'code', 'abbreviation'],
        defaultSort: { name: 'asc' },
        allowedFields: STUDY_ALLOWED_FIELDS,
        minSearchLength: 2,
      },
    );

    const whereClause: Prisma.StudyWhereInput = {
      ...(where as Prisma.StudyWhereInput),
      ...(branchId && { branchId }),
      ...(isPanel !== undefined && { isPanel }),
      ...(!publicOnly && {
        ...(isInternal !== undefined && { isInternal }),
        ...(providerId && { providerId }),
      }),
      ...(sectionId && { sectionId }),
      ...(sampleTypeId && { sampleTypeId }),
      ...(techniqueId && { techniqueId }),
      ...(gender && { gender }),
      ...(ageFormat && { ageFormat }),
      ...(minAge !== undefined && { minAge: { gte: minAge } }),
      ...(maxAge !== undefined && { maxAge: { lte: maxAge } }),
      ...extraWhere,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.study.findMany({
        skip,
        take,
        where: whereClause,
        orderBy,
        include: {
          service: { select: { priceSheetId: true } },
          _count: { select: { panelItems: true } },
          ...CATALOG_INCLUDE,
        },
      }),
      this.prisma.study.count({ where: whereClause }),
    ]);

    const priceSheetIdsToResolve = branchId
      ? [
          ...new Set(
            items
              .map((s) => s.service.priceSheetId)
              .filter((id): id is string => !!id),
          ),
        ]
      : priceSheetId
        ? [priceSheetId]
        : [];

    const priceEntries = priceSheetIdsToResolve.length
      ? await this.prisma.studyOnPriceSheet.findMany({
          where: {
            priceSheetId: { in: priceSheetIdsToResolve },
            studyId: { in: items.map((s) => s.id) },
            ...(publicOnly && { priceSheet: PUBLIC_PRICE_SHEET_WHERE }),
          },
        })
      : [];

    const priceByKey = new Map(
      priceEntries.map((entry) => [
        `${entry.studyId}:${entry.priceSheetId}`,
        entry,
      ]),
    );

    const data = items.map((study) => {
      const { service, ...rest } = study;
      const effectivePriceSheetId = branchId
        ? service.priceSheetId
        : priceSheetId;
      const regionalPrice = effectivePriceSheetId
        ? priceByKey.get(`${study.id}:${effectivePriceSheetId}`)
        : undefined;

      return {
        ...(publicOnly
          ? toStudyResponse(withoutProviderInfo(rest))
          : toStudyResponse(rest)),
        priceInfo: {
          ...toPriceInfo(regionalPrice),
          ...(!publicOnly && { hasConfiguredPrice: !!regionalPrice }),
        },
      };
    });

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOne(id: string) {
    const study = await this.prisma.study.findFirst({
      where: { id, isActive: true },
      include: STUDY_PUBLIC_DETAIL_INCLUDE,
    });
    if (!study) throw studyNotFound(id);
    return this.toPublicStudyDetail(study);
  }

  async findAdminOne(id: string, user: BranchScopedUser) {
    const study = await this.findDetail({ id }, id);
    assertBranchAccess(user, study.branchId);
    return study;
  }

  private async toPublicStudyDetail(
    study: Prisma.StudyGetPayload<{
      include: typeof STUDY_PUBLIC_DETAIL_INCLUDE;
    }>,
  ) {
    const { priceSheetId, ...service } = study.service;
    const entry = priceSheetId
      ? await this.prisma.studyOnPriceSheet.findFirst({
          where: {
            studyId: study.id,
            priceSheetId,
            priceSheet: PUBLIC_PRICE_SHEET_WHERE,
          },
          select: { price: true, showPrice: true },
        })
      : null;

    return {
      ...toStudyResponse(withoutProviderInfo({ ...study, service })),
      priceInfo: toPriceInfo(entry),
    };
  }

  async findInactiveOne(id: string, user: BranchScopedUser) {
    const study = await this.findDetail({ id, isActive: false }, id);
    assertBranchAccess(user, study.branchId);
    return study;
  }

  async findBySlug(slug: string, branchId: string) {
    const study = await this.prisma.study.findUnique({
      where: { branchId_slug: { branchId, slug }, isActive: true },
      include: STUDY_PUBLIC_DETAIL_INCLUDE,
    });
    if (!study) {
      throw new NotFoundException(
        `Estudio con el slug '${slug}' no encontrado en esta sucursal`,
      );
    }
    return this.toPublicStudyDetail(study);
  }

  private async findDetail(where: Prisma.StudyWhereInput, id: string) {
    const study = await this.prisma.study.findFirst({
      where,
      include: STUDY_DETAIL_INCLUDE,
    });
    if (!study) throw studyNotFound(id);
    return toStudyResponse(study);
  }
}
