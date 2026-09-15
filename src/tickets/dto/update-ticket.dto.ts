import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { TicketPriority, TicketStatus } from '@prisma/client';

export class UpdateTicketDto {
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  // null desasigna el ticket; omitir el campo lo deja sin tocar.
  @IsOptional()
  @IsUUID()
  assignedToId?: string | null;
}
