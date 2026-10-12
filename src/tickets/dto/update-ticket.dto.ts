import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { Category, TicketPriority, TicketStatus } from '@prisma/client';

export class UpdateTicketDto {
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @IsEnum(Category)
  category?: Category;

  @IsOptional()
  @IsUUID()
  subcategoryId?: string | null;
}
