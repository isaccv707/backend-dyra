import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import {
  buildPaginatedQuery,
  paginatedResponse,
} from 'src/common/utils/paginate.util';
import {
  assertBranchAccess,
  BranchScopedUser,
  userBranchFilter,
} from 'src/common/utils/branch-access.util';
import {
  QUOTATION_ALLOWED_FIELDS,
  QUOTATION_BRANCH_SELECT,
} from '../constants/quotation-query.const';
import { FindQuotationsDto } from '../dto/find-quotations.dto';
import { QuotationWithItems } from '../types/quotation.types';

/** List, detail and delete quotations of the user's branches. */
@Injectable()
export class QuotationRecordsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(dto: FindQuotationsDto, user: BranchScopedUser) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['folio', 'name', 'lastName', 'phoneNumber', 'email'],
      defaultSort: { createdAt: 'desc' },
      allowedFields: QUOTATION_ALLOWED_FIELDS,
    });

    const finalWhere = {
      ...where,
      ...userBranchFilter(user, dto.branchId),
    } as Prisma.QuotationWhereInput;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.quotation.findMany({
        skip,
        take,
        where: finalWhere,
        orderBy,
        include: {
          items: true,
          branch: { select: { id: true, name: true } },
          priceSheet: { select: { id: true, name: true } },
        },
      }),
      this.prisma.quotation.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOne(
    id: string,
    user: BranchScopedUser,
  ): Promise<QuotationWithItems> {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id },
      include: {
        items: true,
        branch: { select: QUOTATION_BRANCH_SELECT },
        priceSheet: { select: { id: true, name: true } },
      },
    });
    if (!quotation) {
      throw new NotFoundException(`Quotation with ID '${id}' not found`);
    }
    assertBranchAccess(user, quotation.branchId);

    return quotation;
  }

  async remove(id: string, user: BranchScopedUser) {
    await this.findOne(id, user);

    try {
      return await this.prisma.quotation.delete({ where: { id } });
    } catch (error) {
      handleDatabaseErrors(error, 'Quotation');
    }
  }
}
