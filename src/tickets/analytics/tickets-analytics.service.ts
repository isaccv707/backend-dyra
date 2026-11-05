import { Injectable } from '@nestjs/common';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { ExportTicketAnalyticsDto } from './dto/export-ticket-analytics.dto';
import { FindTicketAnalyticsDto } from './dto/find-ticket-analytics.dto';
import { FindTicketTrendDto } from './dto/find-ticket-trend.dto';
import { TicketAnalyticsBreakdownService } from './services/ticket-analytics-breakdown.service';
import { TicketAnalyticsReportService } from './services/ticket-analytics-report.service';
import { TicketAnalyticsSummaryService } from './services/ticket-analytics-summary.service';
import {
  TicketAnalyticsSummary,
  TicketsByAssigneeRow,
  TicketsByCategoryRow,
  TicketsByUserRow,
  TicketTrendResult,
} from './tickets-analytics.types';

/**
 * Entry point of ticket analytics for the controller. Holds no logic: each
 * operation lives in the sub-service of its responsibility.
 */
@Injectable()
export class TicketsAnalyticsService {
  constructor(
    private readonly summaryMetrics: TicketAnalyticsSummaryService,
    private readonly breakdowns: TicketAnalyticsBreakdownService,
    private readonly reports: TicketAnalyticsReportService,
  ) {}

  getSummary(
    dto: FindTicketAnalyticsDto,
    user: RequestUser,
  ): Promise<TicketAnalyticsSummary> {
    return this.summaryMetrics.getSummary(dto, user);
  }

  getTrend(
    dto: FindTicketTrendDto,
    user: RequestUser,
  ): Promise<TicketTrendResult> {
    return this.summaryMetrics.getTrend(dto, user);
  }

  getByUser(
    dto: FindTicketAnalyticsDto,
    user: RequestUser,
  ): Promise<TicketsByUserRow[]> {
    return this.breakdowns.getByUser(dto, user);
  }

  getByAssignee(
    dto: FindTicketAnalyticsDto,
    user: RequestUser,
  ): Promise<TicketsByAssigneeRow[]> {
    return this.breakdowns.getByAssignee(dto, user);
  }

  getByCategory(
    dto: FindTicketAnalyticsDto,
    user: RequestUser,
  ): Promise<TicketsByCategoryRow[]> {
    return this.breakdowns.getByCategory(dto, user);
  }

  exportReport(
    dto: ExportTicketAnalyticsDto,
    user: RequestUser,
  ): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    return this.reports.exportReport(dto, user);
  }
}
