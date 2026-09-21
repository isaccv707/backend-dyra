import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { Category, TicketPriority, TicketStatus } from '@prisma/client';

export class UpdateTicketDto {
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  // Corrección de categorización por parte de TI (tickets:update). Si se
  // manda category sin subcategoryId, no se toca la subcategoría vigente
  // aunque ya no corresponda a la nueva category — mándalos juntos.
  @IsOptional()
  @IsEnum(Category)
  category?: Category;

  // null quita la subcategoría; omitir el campo la deja sin tocar. Debe
  // pertenecer a `category` (la nueva si también se manda, si no la actual
  // del ticket) — validado en TicketsService.
  @IsOptional()
  @IsUUID()
  subcategoryId?: string | null;

  // null desasigna el ticket; omitir el campo lo deja sin tocar.
  @IsOptional()
  @IsUUID()
  assignedToId?: string | null;
}
