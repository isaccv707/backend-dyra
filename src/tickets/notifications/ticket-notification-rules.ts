import { TicketNotificationKind } from '@prisma/client';

/**
 * Who a ticket notice goes to. "tiStaff" = active users with tickets:update
 * of the ticket's branch or global; "assigneesOrTi" = the assignees, or TI if
 * there are none; "administrators" = active users with ESCALATION_ROLE, global
 * or of the ticket's branch.
 */
export type TicketAudience =
  | 'creator'
  | 'assignees'
  | 'tiStaff'
  | 'assigneesOrTi'
  | 'administrators'
  | 'addedAssignees'
  | 'removedAssignees'
  | 'mentioned';

export type TicketNotificationEvent =
  | 'NEW_TICKET'
  | 'COMMENT'
  | 'INTERNAL_NOTE'
  | 'ASSIGNMENT'
  | 'CHANGE'
  | 'RESOLVED'
  | 'FORM_UPDATED'
  | 'FORM_DECIDED'
  | 'OVERDUE'
  | 'SLA_WARNING'
  | 'ESCALATION'
  | 'AUTO_CLOSED'
  | 'MENTION';

export interface TicketNotificationRule {
  /** Stored in TicketNotification.kind (the bell's icon/filter). */
  kind: TicketNotificationKind;
  /** In-app bell + socket toast. */
  inApp: TicketAudience[];
  email: TicketAudience[];
}

/**
 * Single source of truth for ticket notices. The actor of the event never
 * gets their own notice, on any channel.
 */
export const TICKET_NOTIFICATION_RULES: Record<
  TicketNotificationEvent,
  TicketNotificationRule
> = {
  NEW_TICKET: { kind: 'NEW_TICKET', inApp: ['tiStaff'], email: ['tiStaff'] },
  COMMENT: {
    kind: 'COMMENT',
    inApp: ['creator', 'assignees', 'tiStaff'],
    email: [],
  },
  // Internal notes never reach the requester.
  INTERNAL_NOTE: { kind: 'COMMENT', inApp: ['tiStaff'], email: [] },
  ASSIGNMENT: {
    kind: 'ASSIGNMENT',
    inApp: ['creator', 'assignees', 'tiStaff', 'removedAssignees'],
    email: ['addedAssignees'],
  },
  CHANGE: { kind: 'CHANGE', inApp: ['creator', 'assignees'], email: [] },
  // The requester confirms the fix (or replies) before the auto-close.
  RESOLVED: {
    kind: 'CHANGE',
    inApp: ['creator', 'assignees'],
    email: ['creator'],
  },
  FORM_UPDATED: { kind: 'FORM', inApp: ['creator', 'assignees'], email: [] },
  FORM_DECIDED: {
    kind: 'FORM',
    inApp: ['creator', 'assignees'],
    email: ['creator'],
  },
  OVERDUE: {
    kind: 'OVERDUE',
    inApp: ['creator', 'assignees'],
    email: ['assignees'],
  },
  SLA_WARNING: {
    kind: 'SLA_WARNING',
    inApp: ['assigneesOrTi'],
    email: ['assigneesOrTi'],
  },
  // Overdue and still unassigned after ESCALATION_BUSINESS_HOURS.
  ESCALATION: {
    kind: 'ESCALATION',
    inApp: ['administrators'],
    email: ['administrators'],
  },
  AUTO_CLOSED: {
    kind: 'CHANGE',
    inApp: ['creator', 'assignees'],
    email: ['creator'],
  },
  // @mentions in a comment (only participants and TI can be mentioned).
  MENTION: { kind: 'COMMENT', inApp: ['mentioned'], email: ['mentioned'] },
};

/** Events with an email, as the user sees them in their preferences. */
export const TICKET_EMAIL_EVENT_LABELS = {
  NEW_TICKET: 'Ticket nuevo en mi sucursal (TI)',
  ASSIGNMENT: 'Me asignaron un ticket',
  MENTION: 'Me mencionaron en un comentario',
  RESOLVED: 'Mi ticket fue resuelto',
  AUTO_CLOSED: 'Mi ticket se cerró automáticamente',
  FORM_DECIDED: 'Mi solicitud fue aprobada o rechazada',
  SLA_WARNING: 'Un ticket que atiendo está por vencer',
  OVERDUE: 'Un ticket que atiendo venció',
  ESCALATION: 'Escalamiento de tickets vencidos sin asignar',
} as const satisfies Partial<Record<TicketNotificationEvent, string>>;

export type TicketEmailEvent = keyof typeof TICKET_EMAIL_EVENT_LABELS;

export const TICKET_EMAIL_EVENTS = Object.keys(
  TICKET_EMAIL_EVENT_LABELS,
) as TicketEmailEvent[];
