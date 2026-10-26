import { ApiProperty } from '@nestjs/swagger';
import {
  Category,
  TicketFormType,
  TicketNotificationKind,
  TicketPriority,
  TicketStatus,
} from '@prisma/client';

/**
 * Response shapes of the tickets API, for OpenAPI only: the services return
 * Prisma objects with this shape (ticketWithRelations & co. in
 * tickets.shared.ts). Keep both in sync. The Swagger CLI plugin documents the
 * plain properties; enums and JSON columns are declared explicitly.
 */

const JSON_OBJECT = { type: 'object', additionalProperties: true } as const;

export class TicketUserRefDto {
  id!: string;
  name!: string;
}

export class TicketPersonDto extends TicketUserRefDto {
  email!: string;
}

export class TicketBranchRefDto {
  id!: string;
  name!: string;
}

export class TicketAssigneeDto {
  assignedAt!: Date;
  user!: TicketPersonDto;
  /** null if whoever assigned no longer exists. */
  assignedBy!: TicketUserRefDto | null;
}

export class TicketSubcategoryRefDto {
  id!: string;
  @ApiProperty({ enum: Category, enumName: 'TicketCategory' })
  category!: Category;
  name!: string;
  @ApiProperty({
    enum: TicketFormType,
    enumName: 'TicketFormType',
    nullable: true,
  })
  formType!: TicketFormType | null;
}

export class TicketFormDto {
  @ApiProperty({ enum: TicketFormType, enumName: 'TicketFormType' })
  type!: TicketFormType;
  schemaVersion!: number;
  /** Same shape as the `form` sent when creating/editing (by type). */
  @ApiProperty(JSON_OBJECT)
  data!: Record<string, unknown>;
  /** Outcome of the approval (created ids, before/after); null while pending. */
  @ApiProperty({ ...JSON_OBJECT, nullable: true })
  result!: Record<string, unknown> | null;
  appliedAt!: Date | null;
  appliedBy!: TicketUserRefDto | null;
  rejectedAt!: Date | null;
  rejectedBy!: TicketUserRefDto | null;
  rejectionReason!: string | null;
  updatedAt!: Date;
}

export class TicketResponseDto {
  id!: string;
  /** Folio, consecutive per branch. */
  code!: number;
  title!: string;
  description!: string | null;
  @ApiProperty({ enum: TicketStatus, enumName: 'TicketStatus' })
  status!: TicketStatus;
  @ApiProperty({ enum: TicketPriority, enumName: 'TicketPriority' })
  priority!: TicketPriority;
  @ApiProperty({ enum: Category, enumName: 'TicketCategory' })
  category!: Category;
  subcategoryId!: string | null;
  subcategory!: TicketSubcategoryRefDto | null;
  branchId!: string;
  branch!: TicketBranchRefDto;
  createdById!: string;
  createdBy!: TicketPersonDto;
  /** All assignees weigh the same; ordered by assignedAt. Empty = unassigned. */
  assignees!: TicketAssigneeDto[];
  form!: TicketFormDto | null;
  firstResponseAt!: Date | null;
  resolvedAt!: Date | null;
  closedAt!: Date | null;
  reopenedCount!: number;
  dueAt!: Date | null;
  overdueNotifiedAt!: Date | null;
  slaWarnedAt!: Date | null;
  escalatedAt!: Date | null;
  onHoldSince!: Date | null;
  slaPausedSeconds!: number;
  createdAt!: Date;
  updatedAt!: Date;
}

export class TicketCommentResponseDto {
  id!: string;
  body!: string;
  isInternal!: boolean;
  /** Change log line written by the backend (status, assignees, forms…). */
  isSystem!: boolean;
  ticketId!: string;
  /** null = written by the system itself (e.g. auto-close). */
  authorId!: string | null;
  author!: TicketPersonDto | null;
  createdAt!: Date;
}

export class TicketDetailResponseDto extends TicketResponseDto {
  /** Internal notes only for tickets:update. */
  comments!: TicketCommentResponseDto[];
}

export class PaginatedTicketsResponseDto {
  data!: TicketResponseDto[];
  total!: number;
  page!: number;
  limit!: number;
  totalPages!: number;
}

export class AssignableUserDto {
  id!: string;
  name!: string;
  email!: string;
  role!: { name: string };
  isAssigned!: boolean;
}

export class TicketNotificationTicketDto {
  code!: number;
  title!: string;
  @ApiProperty({ enum: TicketStatus, enumName: 'TicketStatus' })
  status!: TicketStatus;
  @ApiProperty({ enum: Category, enumName: 'TicketCategory' })
  category!: Category;
  branch!: TicketBranchRefDto;
}

export class TicketNotificationResponseDto {
  id!: string;
  @ApiProperty({
    enum: TicketNotificationKind,
    enumName: 'TicketNotificationKind',
  })
  kind!: TicketNotificationKind;
  message!: string;
  read!: boolean;
  ticketId!: string;
  userId!: string;
  actorId!: string | null;
  /** null = the system (SLA, auto-close). */
  actor!: TicketUserRefDto | null;
  ticket!: TicketNotificationTicketDto;
  createdAt!: Date;
}

export class PaginatedTicketNotificationsResponseDto {
  data!: TicketNotificationResponseDto[];
  total!: number;
  page!: number;
  limit!: number;
  totalPages!: number;
}

export class TicketFormRoleDto {
  id!: string;
  name!: string;
  description!: string | null;
}

export class TicketFormValidationDto {
  valid!: boolean;
  /** What approving would do, e.g. "creó el estudio X". */
  summary!: string;
}

export class UpdatedCountDto {
  updated!: number;
}

export class DeletedCountDto {
  deleted!: number;
}
