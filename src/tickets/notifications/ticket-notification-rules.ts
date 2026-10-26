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
  | 'removedAssignees';

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
  | 'AUTO_CLOSED';

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
};
