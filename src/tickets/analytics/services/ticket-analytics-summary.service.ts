import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { BUSINESS_TIMEZONE } from '../../constants/business-hours';
import { FindTicketAnalyticsDto } from '../dto/find-ticket-analytics.dto';
import { FindTicketTrendDto } from '../dto/find-ticket-trend.dto';
import {
  TicketAnalyticsSummary,
  TicketTrendResult,
} from '../tickets-analytics.types';
import {
  SummaryDurationRow,
  toSeconds,
  TrendRow,
} from '../utils/ticket-analytics-raw.util';
import { TicketAnalyticsFiltersService } from './ticket-analytics-filters.service';

/** Overall counts and averages, and the created/resolved trend. */
@Injectable()
export class TicketAnalyticsSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly filters: TicketAnalyticsFiltersService,
  ) {}

  async getSummary(
    dto: FindTicketAnalyticsDto,
    user: RequestUser,
  ): Promise<TicketAnalyticsSummary> {
    const where = this.filters.buildPrismaWhere(dto, user);
    const whereSql = this.filters.whereSql(
      this.filters.buildRawWhereFragments(dto, user),
    );

    const [statusCounts, priorityCounts, categoryCounts, total, durationRows] =
      await Promise.all([
        this.prisma.ticket.groupBy({
          by: ['status'],
          where,
          _count: { _all: true },
        }),
        this.prisma.ticket.groupBy({
          by: ['priority'],
          where,
          _count: { _all: true },
        }),
        this.prisma.ticket.groupBy({
          by: ['category'],
          where,
          _count: { _all: true },
        }),
        this.prisma.ticket.count({ where }),
        this.prisma.$queryRaw<SummaryDurationRow[]>(Prisma.sql`
          SELECT
            AVG(EXTRACT(EPOCH FROM (first_response_at - "createdAt"))) AS avg_first_response_seconds,
            AVG(EXTRACT(EPOCH FROM (resolved_at - "createdAt"))) AS avg_resolution_seconds,
            COUNT(*) FILTER (WHERE reopened_count > 0) AS reopened,
            COUNT(*) FILTER (WHERE due_at < now() AND status NOT IN ('RESOLVED', 'CLOSED', 'CANCELLED')) AS overdue
          FROM tickets
          ${whereSql}
        `),
      ]);

    const durationRow = durationRows[0];
    const reopenedCount = Number(durationRow?.reopened ?? 0);

    return {
      total,
      byStatus: statusCounts.map((s) => ({
        status: s.status,
        count: s._count._all,
      })),
      byPriority: priorityCounts.map((p) => ({
        priority: p.priority,
        count: p._count._all,
      })),
      byCategory: categoryCounts.map((c) => ({
        category: c.category,
        count: c._count._all,
      })),
      avgFirstResponseSeconds: toSeconds(
        durationRow?.avg_first_response_seconds ?? null,
      ),
      avgResolutionSeconds: toSeconds(
        durationRow?.avg_resolution_seconds ?? null,
      ),
      reopenedCount,
      reopenedRate: total > 0 ? reopenedCount / total : 0,
      overdueCount: Number(durationRow?.overdue ?? 0),
    };
  }

  async getTrend(
    dto: FindTicketTrendDto,
    user: RequestUser,
  ): Promise<TicketTrendResult> {
    const interval = dto.interval ?? 'day';
    const fragments = this.filters.buildRawWhereFragments(dto, user);
    const whereSql = this.filters.whereSql(fragments);
    const resolvedWhereSql = this.filters.whereSql([
      ...fragments,
      Prisma.sql`resolved_at IS NOT NULL`,
    ]);

    // Las columnas guardan UTC sin zona; se agrupa por el día/semana/mes local
    // del laboratorio y se devuelve como fecha calendario "YYYY-MM-DD".
    const bucketOf = (column: Prisma.Sql) =>
      Prisma.sql`to_char(date_trunc(${interval}, (${column} AT TIME ZONE 'UTC') AT TIME ZONE ${BUSINESS_TIMEZONE}), 'YYYY-MM-DD')`;

    const [createdRows, resolvedRows] = await Promise.all([
      this.prisma.$queryRaw<TrendRow[]>(Prisma.sql`
        SELECT ${bucketOf(Prisma.sql`"createdAt"`)} AS bucket, COUNT(*) AS count
        FROM tickets
        ${whereSql}
        GROUP BY bucket
        ORDER BY bucket ASC
      `),
      this.prisma.$queryRaw<TrendRow[]>(Prisma.sql`
        SELECT ${bucketOf(Prisma.sql`resolved_at`)} AS bucket, COUNT(*) AS count
        FROM tickets
        ${resolvedWhereSql}
        GROUP BY bucket
        ORDER BY bucket ASC
      `),
    ]);

    return {
      interval,
      created: createdRows.map((r) => ({
        date: r.bucket,
        count: Number(r.count),
      })),
      resolved: resolvedRows.map((r) => ({
        date: r.bucket,
        count: Number(r.count),
      })),
    };
  }
}
