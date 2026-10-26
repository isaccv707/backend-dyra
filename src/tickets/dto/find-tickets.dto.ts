import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import {
  Category,
  TicketFormType,
  TicketPriority,
  TicketStatus,
} from '@prisma/client';

export const TICKET_FORM_STATUSES = ['PENDING', 'APPLIED', 'REJECTED'] as const;
export type TicketFormStatus = (typeof TICKET_FORM_STATUSES)[number];
import { PaginatedQueryDto } from 'src/common/dto/paginated-query.dto';

export class FindTicketsDto extends PaginatedQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @IsOptional()
  @IsEnum(Category)
  category?: Category;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  assignedToMe?: boolean;

  /**
   * "Mis tickets": only the ones the user created or is assigned to, even with
   * tickets:update. With branchId, created tickets are limited to that branch;
   * assigned ones from branches the user has no access to are always included.
   */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  mine?: boolean;

  @IsOptional()
  @IsUUID()
  subcategoryId?: string;

  /** Tickets whose form is of this type. */
  @IsOptional()
  @IsEnum(TicketFormType)
  formType?: TicketFormType;

  /**
   * PENDING: waiting for IT (not approved, rejected, closed or cancelled);
   * APPLIED / REJECTED: already decided.
   */
  @IsOptional()
  @IsIn(TICKET_FORM_STATUSES, {
    message: `formStatus debe ser uno de: ${TICKET_FORM_STATUSES.join(', ')}`,
  })
  formStatus?: TicketFormStatus;
}
