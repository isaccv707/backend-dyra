import { IsIn, IsOptional } from 'class-validator';
import { FindTicketAnalyticsDto } from './find-ticket-analytics.dto';

export type TicketAnalyticsExportFormat = 'xlsx' | 'pdf';

export class ExportTicketAnalyticsDto extends FindTicketAnalyticsDto {
  @IsOptional()
  @IsIn(['xlsx', 'pdf'])
  format?: TicketAnalyticsExportFormat = 'xlsx';
}
