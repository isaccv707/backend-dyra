import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { CATEGORY_LABELS } from '../../tickets.shared';
import { FindTicketAnalyticsDto } from '../dto/find-ticket-analytics.dto';
import {
  TicketsByAssigneeRow,
  TicketsByCategoryRow,
  TicketsByUserRow,
} from '../tickets-analytics.types';
import {
  GroupDurationRow,
  toSeconds,
} from '../utils/ticket-analytics-raw.util';
import { TicketAnalyticsFiltersService } from './ticket-analytics-filters.service';

/** Highest first; ties by label (Spanish collation), so the order is stable. */
const byRankThenLabel =
  <T>(rank: (row: T) => number, label: (row: T) => string) =>
  (a: T, b: T) =>
    rank(b) - rank(a) || label(a).localeCompare(label(b), 'es');

/** Tickets grouped by reporter, assignee and category. */
@Injectable()
export class TicketAnalyticsBreakdownService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly filters: TicketAnalyticsFiltersService,
  ) {}

  async getByUser(
    dto: FindTicketAnalyticsDto,
    user: RequestUser,
  ): Promise<TicketsByUserRow[]> {
    const where = this.filters.buildPrismaWhere(dto, user);

    const grouped = await this.prisma.ticket.groupBy({
      by: ['createdById'],
      where,
      _count: { _all: true },
    });
    if (grouped.length === 0) return [];

    const userIds = grouped.map((g) => g.createdById);
    const [users, durations, statusBreakdown] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      }),
      this.getAvgResolutionByGroup('created_by_id', dto, user),
      this.prisma.ticket.groupBy({
        by: ['createdById', 'status'],
        where,
        _count: { _all: true },
      }),
    ]);

    const userMap = new Map(users.map((u) => [u.id, u]));
    const durationMap = new Map(durations.map((d) => [d.groupKey, d]));

    return grouped
      .map((g) => {
        const reporter = userMap.get(g.createdById);
        const duration = durationMap.get(g.createdById);
        return {
          userId: g.createdById,
          name: reporter?.name ?? 'Usuario eliminado',
          email: reporter?.email ?? null,
          total: g._count._all,
          byStatus: statusBreakdown
            .filter((s) => s.createdById === g.createdById)
            .map((s) => ({ status: s.status, count: s._count._all })),
          avgResolutionSeconds: duration?.avgResolutionSeconds ?? null,
        };
      })
      .sort(
        byRankThenLabel(
          (r) => r.total,
          (r) => r.name,
        ),
      );
  }

  async getByAssignee(
    dto: FindTicketAnalyticsDto,
    user: RequestUser,
  ): Promise<TicketsByAssigneeRow[]> {
    const where = this.filters.buildPrismaWhere(dto, user);
    const unassignedWhere: Prisma.TicketWhereInput = {
      ...where,
      assignees: { none: {} },
    };

    const [grouped, reopenCounts, unassigned, unassignedReopened, durations] =
      await Promise.all([
        this.prisma.ticketAssignee.groupBy({
          by: ['userId'],
          where: { ticket: where },
          _count: { _all: true },
        }),
        this.prisma.ticketAssignee.groupBy({
          by: ['userId'],
          where: { ticket: { ...where, reopenedCount: { gt: 0 } } },
          _count: { _all: true },
        }),
        this.prisma.ticket.count({ where: unassignedWhere }),
        this.prisma.ticket.count({
          where: { ...unassignedWhere, reopenedCount: { gt: 0 } },
        }),
        this.getAvgResolutionByAssignee(dto, user),
      ]);

    const users = await this.prisma.user.findMany({
      where: { id: { in: grouped.map((g) => g.userId) } },
      select: { id: true, name: true },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));
    const durationMap = new Map(durations.map((d) => [d.groupKey, d]));
    const reopenMap = new Map(
      reopenCounts.map((r) => [r.userId, r._count._all]),
    );

    const rows: TicketsByAssigneeRow[] = grouped.map((g) => ({
      assigneeId: g.userId,
      name: userMap.get(g.userId)?.name ?? 'Usuario eliminado',
      total: g._count._all,
      reopenedCount: reopenMap.get(g.userId) ?? 0,
      avgResolutionSeconds:
        durationMap.get(g.userId)?.avgResolutionSeconds ?? null,
    }));

    if (unassigned > 0) {
      rows.push({
        assigneeId: null,
        name: 'Sin asignar',
        total: unassigned,
        reopenedCount: unassignedReopened,
        avgResolutionSeconds: null,
      });
    }

    return rows.sort(
      byRankThenLabel(
        (r) => r.total,
        (r) => r.name,
      ),
    );
  }

  async getByCategory(
    dto: FindTicketAnalyticsDto,
    user: RequestUser,
  ): Promise<TicketsByCategoryRow[]> {
    const where = this.filters.buildPrismaWhere(dto, user);

    const [categoryGroups, subcategoryGroups, total] = await Promise.all([
      this.prisma.ticket.groupBy({
        by: ['category'],
        where,
        _count: { _all: true },
      }),
      this.prisma.ticket.groupBy({
        by: ['category', 'subcategoryId'],
        where: { ...where, subcategoryId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.ticket.count({ where }),
    ]);

    const subcategoryIds = [
      ...new Set(
        subcategoryGroups
          .map((g) => g.subcategoryId)
          .filter((id): id is string => !!id),
      ),
    ];
    const subcategories = await this.prisma.ticketSubcategory.findMany({
      where: { id: { in: subcategoryIds } },
      select: { id: true, name: true },
    });
    const subcategoryNameMap = new Map(
      subcategories.map((s) => [s.id, s.name]),
    );

    return categoryGroups
      .map((c) => ({
        category: c.category,
        count: c._count._all,
        percentage: total > 0 ? c._count._all / total : 0,
        subcategories: subcategoryGroups
          .filter((s) => s.category === c.category)
          .map((s) => ({
            subcategoryId: s.subcategoryId,
            name:
              subcategoryNameMap.get(s.subcategoryId as string) ??
              'Desconocida',
            count: s._count._all,
          }))
          .sort(
            byRankThenLabel(
              (s) => s.count,
              (s) => s.name,
            ),
          ),
      }))
      .sort(
        byRankThenLabel(
          (c) => c.count,
          (c) => CATEGORY_LABELS[c.category],
        ),
      );
  }

  private async getAvgResolutionByGroup(
    column: 'created_by_id',
    dto: FindTicketAnalyticsDto,
    user: RequestUser,
  ): Promise<
    { groupKey: string | null; avgResolutionSeconds: number | null }[]
  > {
    const whereSql = this.filters.whereSql(
      this.filters.buildRawWhereFragments(dto, user),
    );

    const rows = await this.prisma.$queryRaw<GroupDurationRow[]>(Prisma.sql`
      SELECT ${Prisma.raw(column)} AS group_key,
        AVG(EXTRACT(EPOCH FROM (resolved_at - "createdAt"))) AS avg_resolution_seconds
      FROM tickets
      ${whereSql}
      GROUP BY ${Prisma.raw(column)}
    `);

    return rows.map((r) => ({
      groupKey: r.group_key,
      avgResolutionSeconds: toSeconds(r.avg_resolution_seconds),
    }));
  }

  private async getAvgResolutionByAssignee(
    dto: FindTicketAnalyticsDto,
    user: RequestUser,
  ): Promise<
    { groupKey: string | null; avgResolutionSeconds: number | null }[]
  > {
    const whereSql = this.filters.whereSql(
      this.filters.buildRawWhereFragments(dto, user),
    );

    const rows = await this.prisma.$queryRaw<GroupDurationRow[]>(Prisma.sql`
      SELECT ta.user_id AS group_key,
        AVG(EXTRACT(EPOCH FROM (t.resolved_at - t."createdAt"))) AS avg_resolution_seconds
      FROM tickets t
      JOIN ticket_assignees ta ON ta.ticket_id = t.id
      ${whereSql}
      GROUP BY ta.user_id
    `);

    return rows.map((r) => ({
      groupKey: r.group_key,
      avgResolutionSeconds: toSeconds(r.avg_resolution_seconds),
    }));
  }
}
