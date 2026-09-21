import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { Category, TicketPriority } from '@prisma/client';

export class FindTicketAnalyticsDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsEnum(Category)
  category?: Category;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;
}
