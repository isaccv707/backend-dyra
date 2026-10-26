import {
  Category,
  Prisma,
  TicketNotificationKind,
  TicketPriority,
  TicketStatus,
} from '@prisma/client';

export const TICKET_UPDATE_PERMISSION = 'tickets:update';

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  OPEN: 'Abierto',
  IN_PROGRESS: 'En progreso',
  ON_HOLD: 'En espera',
  RESOLVED: 'Resuelto',
  CLOSED: 'Cerrado',
  CANCELLED: 'Cancelado',
};

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  CRITICAL: 'Crítica',
};

export const CATEGORY_LABELS: Record<Category, string> = {
  HARDWARE: 'Hardware',
  SOFTWARE: 'Software',
  ACCESS: 'Accesos',
  COGNITI: 'CogniTI',
  OTHER: 'Otro',
};

export const REOPENABLE_STATUSES: TicketStatus[] = ['RESOLVED', 'CLOSED'];

export const FORM_LOCKED_STATUSES: TicketStatus[] = ['CLOSED', 'CANCELLED'];

export const ticketWithRelations = Prisma.validator<Prisma.TicketDefaultArgs>()(
  {
    include: {
      branch: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true, email: true } },
      assignees: {
        orderBy: { assignedAt: 'asc' },
        select: {
          assignedAt: true,
          user: { select: { id: true, name: true, email: true } },
          assignedBy: { select: { id: true, name: true } },
        },
      },
      subcategory: {
        select: { id: true, category: true, name: true, formType: true },
      },
      form: {
        select: {
          type: true,
          schemaVersion: true,
          data: true,
          result: true,
          appliedAt: true,
          appliedBy: { select: { id: true, name: true } },
          rejectedAt: true,
          rejectedBy: { select: { id: true, name: true } },
          rejectionReason: true,
          updatedAt: true,
        },
      },
    },
  },
);

export type TicketWithRelations = Prisma.TicketGetPayload<
  typeof ticketWithRelations
>;

export const commentWithAuthor =
  Prisma.validator<Prisma.TicketCommentDefaultArgs>()({
    include: {
      author: { select: { id: true, name: true, email: true } },
    },
  });

export type TicketCommentWithAuthor = Prisma.TicketCommentGetPayload<
  typeof commentWithAuthor
>;

export const ticketWithFullRelations =
  Prisma.validator<Prisma.TicketDefaultArgs>()({
    include: {
      ...ticketWithRelations.include,
      comments: {
        orderBy: { createdAt: 'asc' },
        ...commentWithAuthor,
      },
    },
  });

export type TicketWithFullRelations = Prisma.TicketGetPayload<
  typeof ticketWithFullRelations
>;

/** One change of a ticket: a TicketEvent plus its text in the system comment. */
export interface ChangeEntry {
  type: Prisma.TicketEventCreateManyInput['type'];
  fromValue: string | null;
  toValue: string | null;
  text: string;
}

export const notificationKindOf = (
  entries: ChangeEntry[],
): TicketNotificationKind =>
  entries.some((e) => e.type.startsWith('FORM_'))
    ? 'FORM'
    : entries.some((e) => e.type === 'ASSIGNED' || e.type === 'UNASSIGNED')
      ? 'ASSIGNMENT'
      : 'CHANGE';

export const assigneeIdsOf = (ticket: {
  assignees: { user: { id: string } }[];
}) => ticket.assignees.map((a) => a.user.id);
