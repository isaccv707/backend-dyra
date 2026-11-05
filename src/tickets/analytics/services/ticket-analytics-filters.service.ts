import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { userBranchFilter } from 'src/common/utils/branch-access.util';
import { startOfLocalDay } from '../../constants/business-hours';
import { FindTicketAnalyticsDto } from '../dto/find-ticket-analytics.dto';

interface CreatedAtRange {
  gte?: Date;
  lt?: Date;
  lte?: Date;
}

export const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Turns the analytics filters into Prisma `where` and raw SQL fragments. */
@Injectable()
export class TicketAnalyticsFiltersService {
  buildPrismaWhere(
    dto: FindTicketAnalyticsDto,
    user: RequestUser,
  ): Prisma.TicketWhereInput {
    const createdAt = this.resolveCreatedAtRange(dto);

    return {
      ...userBranchFilter(user, dto.branchId),
      ...(createdAt && { createdAt }),
      ...(dto.category && { category: dto.category }),
      ...(dto.priority && { priority: dto.priority }),
    };
  }

  private resolveEffectiveBranchIds(
    user: RequestUser,
    branchId?: string,
  ): string[] | null {
    const where = userBranchFilter(user, branchId) as {
      branchId?: string | { in: string[] };
    };

    if (!where.branchId) return null;
    if (typeof where.branchId === 'string') return [where.branchId];
    return where.branchId.in;
  }

  buildRawWhereFragments(
    dto: FindTicketAnalyticsDto,
    user: RequestUser,
  ): Prisma.Sql[] {
    const fragments: Prisma.Sql[] = [];

    const branchIds = this.resolveEffectiveBranchIds(user, dto.branchId);
    if (branchIds) {
      fragments.push(Prisma.sql`branch_id = ANY(${branchIds})`);
    }
    const createdAt = this.resolveCreatedAtRange(dto);
    if (createdAt?.gte) {
      fragments.push(Prisma.sql`"createdAt" >= ${createdAt.gte}`);
    }
    if (createdAt?.lt) {
      fragments.push(Prisma.sql`"createdAt" < ${createdAt.lt}`);
    }
    if (createdAt?.lte) {
      fragments.push(Prisma.sql`"createdAt" <= ${createdAt.lte}`);
    }
    if (dto.category) {
      fragments.push(Prisma.sql`category = ${dto.category}::"Category"`);
    }
    if (dto.priority) {
      fragments.push(Prisma.sql`priority = ${dto.priority}::"TicketPriority"`);
    }

    return fragments;
  }

  /**
   * Rango de `createdAt` para from/to. Una fecha sola ("YYYY-MM-DD") es un día
   * calendario del laboratorio (BUSINESS_TIMEZONE) y `to` incluye el día
   * completo; un ISO con hora se usa tal cual.
   */
  private resolveCreatedAtRange(
    dto: FindTicketAnalyticsDto,
  ): CreatedAtRange | null {
    if (!dto.from && !dto.to) return null;

    const range: CreatedAtRange = {};
    if (dto.from) {
      range.gte = DATE_ONLY_RE.test(dto.from)
        ? startOfLocalDay(dto.from)
        : new Date(dto.from);
    }
    if (dto.to) {
      if (DATE_ONLY_RE.test(dto.to)) range.lt = startOfLocalDay(dto.to, 1);
      else range.lte = new Date(dto.to);
    }

    const isEmpty = range.lt
      ? range.gte && range.gte >= range.lt
      : range.gte && range.lte && range.gte > range.lte;
    if (isEmpty) {
      throw new BadRequestException(
        'La fecha inicial no puede ser posterior a la fecha final',
      );
    }

    return range;
  }

  whereSql(fragments: Prisma.Sql[]): Prisma.Sql {
    if (fragments.length === 0) return Prisma.empty;
    return Prisma.sql`WHERE ${Prisma.join(fragments, ' AND ')}`;
  }
}
