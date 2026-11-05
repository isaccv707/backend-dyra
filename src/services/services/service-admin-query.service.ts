import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import {
  assertBranchAccess,
  userBranchFilter,
  type BranchScopedUser,
} from 'src/common/utils/branch-access.util';
import {
  buildPaginatedQuery,
  paginatedResponse,
} from 'src/common/utils/paginate.util';
import { studyTitle } from 'src/studies/utils/study-title.util';
import {
  ADMIN_PRICE_SHEET_SELECT,
  SERVICE_ALLOWED_FIELDS,
} from '../constants/service-query.const';
import {
  FindAdminServicesDto,
  FindAdminServiceStudiesDto,
} from '../dto/find-admin-services.dto';

/** Admin reads, scoped to the user's branches. */
@Injectable()
export class ServiceAdminQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Admin list: active and inactive services of the user's branches, with the
   * real total of studies (inactive and unpriced included) in _count.studies.
   */
  async findAdminAll(dto: FindAdminServicesDto, user: BranchScopedUser) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['name', 'description'],
      allowedFields: SERVICE_ALLOWED_FIELDS,
      defaultSort: { name: 'asc' },
    });

    const whereClause: Prisma.ServiceWhereInput = {
      AND: [
        where,
        {
          ...userBranchFilter(user, dto.branchId),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      ],
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
          priceSheet: { select: ADMIN_PRICE_SHEET_SELECT },
          _count: { select: { studies: true } },
        },
      }),
      this.prisma.service.count({ where: whereClause }),
    ]);

    return paginatedResponse(services, total, dto.page ?? 1, dto.limit ?? 10);
  }

  /**
   * Admin detail: the assigned sheet whatever its visibility/status, and every
   * study of the service (unpriced ones flagged with hasConfiguredPrice).
   */
  async findAdminOne(
    id: string,
    dto: FindAdminServiceStudiesDto,
    user: BranchScopedUser,
  ) {
    const { page = 1, limit = 10, search, isPanel, isActive } = dto;

    const service = await this.prisma.service.findUnique({
      where: { id },
      include: {
        benefits: true,
        details: true,
        branch: true,
        priceSheet: { select: ADMIN_PRICE_SHEET_SELECT },
        _count: { select: { studies: true } },
      },
    });
    if (!service)
      throw new NotFoundException(`The Service with id: ${id} not found`);
    assertBranchAccess(user, service.branchId);

    const term = search?.trim();
    const studiesWhere: Prisma.StudyWhereInput = {
      serviceId: service.id,
      ...(isActive !== undefined && { isActive }),
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
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          title: true,
          code: true,
          slug: true,
          isPanel: true,
          isActive: true,
          description: true,
          preparation: true,
          sampleType: { select: { name: true } },
          section: { select: { name: true } },
        },
      }),
      this.prisma.study.count({ where: studiesWhere }),
    ]);

    const priceEntries = service.priceSheetId
      ? await this.prisma.studyOnPriceSheet.findMany({
          where: {
            priceSheetId: service.priceSheetId,
            studyId: { in: studies.map((s) => s.id) },
          },
        })
      : [];
    const priceByStudyId = new Map(
      priceEntries.map((entry) => [entry.studyId, entry]),
    );

    return {
      ...service,
      studies: paginatedResponse(
        studies.map((study) => {
          const regionalPrice = priceByStudyId.get(study.id);
          return {
            ...study,
            title: studyTitle(study),
            sampleType: study.sampleType?.name ?? null,
            section: study.section?.name ?? null,
            priceInfo: {
              showPrice: regionalPrice?.showPrice ?? false,
              price: regionalPrice?.price ?? null,
              hasConfiguredPrice: !!regionalPrice,
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
