import { IsIn, IsOptional } from 'class-validator';
import { FindTicketAnalyticsDto } from './find-ticket-analytics.dto';

export type TicketTrendInterval = 'day' | 'week' | 'month';

export class FindTicketTrendDto extends FindTicketAnalyticsDto {
  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  interval?: TicketTrendInterval = 'day';
}
