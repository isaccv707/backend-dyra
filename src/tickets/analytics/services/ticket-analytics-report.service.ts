import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import {
  CATEGORY_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
} from '../../tickets.shared';
import {
  BUSINESS_TIMEZONE,
  startOfLocalDay,
} from '../../constants/business-hours';
import { ExportTicketAnalyticsDto } from '../dto/export-ticket-analytics.dto';
import { TicketAnalyticsPdfRenderer } from '../ticket-analytics-pdf.renderer';
import {
  TicketAnalyticsSummary,
  TicketsByCategoryRow,
  TicketsByUserRow,
} from '../tickets-analytics.types';
import { TicketAnalyticsBreakdownService } from './ticket-analytics-breakdown.service';
import { DATE_ONLY_RE } from './ticket-analytics-filters.service';
import { TicketAnalyticsSummaryService } from './ticket-analytics-summary.service';

/** Excel and PDF report of the analytics. */
@Injectable()
export class TicketAnalyticsReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly summaryMetrics: TicketAnalyticsSummaryService,
    private readonly breakdowns: TicketAnalyticsBreakdownService,
    private readonly pdfRenderer: TicketAnalyticsPdfRenderer,
  ) {}

  async exportReport(
    dto: ExportTicketAnalyticsDto,
    user: RequestUser,
  ): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    const [summary, byCategory, byUser] = await Promise.all([
      this.summaryMetrics.getSummary(dto, user),
      this.breakdowns.getByCategory(dto, user),
      this.breakdowns.getByUser(dto, user),
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
}
