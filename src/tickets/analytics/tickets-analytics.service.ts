import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { userBranchFilter } from 'src/common/utils/branch-access.util';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import {
  CATEGORY_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
} from '../tickets.shared';
import {
  BUSINESS_TIMEZONE,
  startOfLocalDay,
} from '../constants/business-hours';
import { FindTicketAnalyticsDto } from './dto/find-ticket-analytics.dto';
import { FindTicketTrendDto } from './dto/find-ticket-trend.dto';
import { ExportTicketAnalyticsDto } from './dto/export-ticket-analytics.dto';
import {
  TicketAnalyticsSummary,
  TicketsByAssigneeRow,
  TicketsByCategoryRow,
  TicketsByUserRow,
  TicketTrendResult,
} from './tickets-analytics.types';
import { TicketAnalyticsPdfRenderer } from './ticket-analytics-pdf.renderer';

// AVG() de Postgres es numeric: Prisma lo entrega como Decimal (string en JSON).
type RawAvg = Prisma.Decimal | number | null;

interface SummaryDurationRow {
  avg_first_response_seconds: RawAvg;
  avg_resolution_seconds: RawAvg;
  reopened: bigint;
  overdue: bigint;
}

interface GroupDurationRow {
  group_key: string | null;
  avg_resolution_seconds: RawAvg;
}

interface TrendRow {
  bucket: string;
  count: bigint;
}

interface CreatedAtRange {
  gte?: Date;
  lt?: Date;
  lte?: Date;
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

const toSeconds = (value: RawAvg): number | null =>
  value === null || value === undefined ? null : Number(value);

@Injectable()
export class TicketsAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdfRenderer: TicketAnalyticsPdfRenderer,
  ) {}

  async getSummary(
    dto: FindTicketAnalyticsDto,
    user: RequestUser,
  ): Promise<TicketAnalyticsSummary> {
    const where = this.buildPrismaWhere(dto, user);
    const whereSql = this.whereSql(this.buildRawWhereFragments(dto, user));

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

  async getByUser(
    dto: FindTicketAnalyticsDto,
    user: RequestUser,
  ): Promise<TicketsByUserRow[]> {
    const where = this.buildPrismaWhere(dto, user);

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
      .sort((a, b) => b.total - a.total);
  }

  async getByAssignee(
    dto: FindTicketAnalyticsDto,
    user: RequestUser,
  ): Promise<TicketsByAssigneeRow[]> {
    const where = this.buildPrismaWhere(dto, user);
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

    return rows.sort((a, b) => b.total - a.total);
  }

  async getByCategory(
    dto: FindTicketAnalyticsDto,
    user: RequestUser,
  ): Promise<TicketsByCategoryRow[]> {
    const where = this.buildPrismaWhere(dto, user);

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
          .sort((a, b) => b.count - a.count),
      }))
      .sort((a, b) => b.count - a.count);
  }

  async getTrend(
    dto: FindTicketTrendDto,
    user: RequestUser,
  ): Promise<TicketTrendResult> {
    const interval = dto.interval ?? 'day';
    const fragments = this.buildRawWhereFragments(dto, user);
    const whereSql = this.whereSql(fragments);
    const resolvedWhereSql = this.whereSql([
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

  async exportReport(
    dto: ExportTicketAnalyticsDto,
    user: RequestUser,
  ): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    const [summary, byCategory, byUser] = await Promise.all([
      this.getSummary(dto, user),
      this.getByCategory(dto, user),
      this.getByUser(dto, user),
    ]);

    if (dto.format === 'pdf') {
      const branchName = dto.branchId
        ? ((
            await this.prisma.branch.findUnique({
              where: { id: dto.branchId },
              select: { name: true },
            })
          )?.name ?? null)
        : null;

      return await this.buildPdfReport(summary, byCategory, byUser, {
        logoPath: this.resolveLogoPath(),
        filtersLabel: this.buildFiltersLabel(dto, branchName),
      });
    }
    return this.buildXlsxReport(summary, byCategory, byUser);
  }

  private resolveLogoPath(): string | null {
    const rootDir = process.cwd();
    const candidatePaths = [
      path.join(rootDir, 'dist', 'assets', 'logo.png'),
      path.join(rootDir, 'src', 'assets', 'logo.png'),
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) return p;
    }

    console.warn(
      'No se pudo cargar el logo para el PDF de analytics de tickets.',
    );
    return null;
  }

  private buildFiltersLabel(
    dto: ExportTicketAnalyticsDto,
    branchName: string | null,
  ): string | null {
    const parts: string[] = [];

    if (dto.from || dto.to) {
      const format = (value?: string) =>
        value
          ? (DATE_ONLY_RE.test(value)
              ? startOfLocalDay(value)
              : new Date(value)
            ).toLocaleDateString('es-MX', { timeZone: BUSINESS_TIMEZONE })
          : '…';
      parts.push(`Periodo: ${format(dto.from)} – ${format(dto.to)}`);
    }
    if (branchName) parts.push(`Sucursal: ${branchName}`);
    if (dto.category) parts.push(`Categoría: ${CATEGORY_LABELS[dto.category]}`);
    if (dto.priority) {
      parts.push(`Prioridad: ${TICKET_PRIORITY_LABELS[dto.priority]}`);
    }

    return parts.length ? parts.join('   ·   ') : null;
  }

  private buildXlsxReport(
    summary: TicketAnalyticsSummary,
    byCategory: TicketsByCategoryRow[],
    byUser: TicketsByUserRow[],
  ) {
    const workbook = XLSX.utils.book_new();

    const summaryRows = [
      { metrica: 'Total de tickets', valor: summary.total },
      {
        metrica: 'Tiempo prom. primera respuesta (h)',
        valor: this.secondsToHours(summary.avgFirstResponseSeconds),
      },
      {
        metrica: 'Tiempo prom. resolución (h)',
        valor: this.secondsToHours(summary.avgResolutionSeconds),
      },
      { metrica: 'Tickets reabiertos', valor: summary.reopenedCount },
      {
        metrica: 'Tasa de reapertura',
        valor: `${Math.round(summary.reopenedRate * 1000) / 10}%`,
      },
      { metrica: 'Tickets vencidos (SLA)', valor: summary.overdueCount },
      ...summary.byStatus.map((s) => ({
        metrica: `Estado: ${TICKET_STATUS_LABELS[s.status]}`,
        valor: s.count,
      })),
      ...summary.byPriority.map((p) => ({
        metrica: `Prioridad: ${TICKET_PRIORITY_LABELS[p.priority]}`,
        valor: p.count,
      })),
    ];
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(summaryRows, { header: ['metrica', 'valor'] }),
      'Resumen',
    );

    const categoryRows = byCategory.flatMap((c) => [
      {
        categoria: CATEGORY_LABELS[c.category],
        subcategoria: '(todas)',
        tickets: c.count,
      },
      ...c.subcategories.map((s) => ({
        categoria: CATEGORY_LABELS[c.category],
        subcategoria: s.name,
        tickets: s.count,
      })),
    ]);
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(categoryRows, {
        header: ['categoria', 'subcategoria', 'tickets'],
      }),
      'Por categoria',
    );

    const userRows = byUser.map((u) => ({
      usuario: u.name,
      correo: u.email ?? '',
      total: u.total,
      tiempoPromResolucionHoras: this.secondsToHours(u.avgResolutionSeconds),
    }));
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(userRows, {
        header: ['usuario', 'correo', 'total', 'tiempoPromResolucionHoras'],
      }),
      'Por usuario',
    );

    const buffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
    }) as Buffer;

    return {
      buffer,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: 'reporte-tickets.xlsx',
    };
  }

  private async buildPdfReport(
    summary: TicketAnalyticsSummary,
    byCategory: TicketsByCategoryRow[],
    byUser: TicketsByUserRow[],
    meta: { logoPath: string | null; filtersLabel: string | null },
  ) {
    const buffer = await this.pdfRenderer.renderToBuffer({
      summary,
      byCategory,
      byUser,
      meta,
    });
    return {
      buffer,
      contentType: 'application/pdf',
      filename: 'reporte-tickets.pdf',
    };
  }

  private secondsToHours(seconds: number | null): number | null {
    if (seconds === null || seconds === undefined) return null;
    return Math.round((seconds / 3600) * 10) / 10;
  }

  private buildPrismaWhere(
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

  private buildRawWhereFragments(
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

  private whereSql(fragments: Prisma.Sql[]): Prisma.Sql {
    if (fragments.length === 0) return Prisma.empty;
    return Prisma.sql`WHERE ${Prisma.join(fragments, ' AND ')}`;
  }

  private async getAvgResolutionByGroup(
    column: 'created_by_id',
    dto: FindTicketAnalyticsDto,
    user: RequestUser,
  ): Promise<
    { groupKey: string | null; avgResolutionSeconds: number | null }[]
  > {
    const whereSql = this.whereSql(this.buildRawWhereFragments(dto, user));

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
    const whereSql = this.whereSql(this.buildRawWhereFragments(dto, user));

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
