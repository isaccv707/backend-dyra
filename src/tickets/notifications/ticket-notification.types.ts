import { MailJob } from 'src/mail/mail-queue.service';

/** What every notice needs to resolve its audiences. */
export interface NotifiableTicket {
  id: string;
  code: number;
  title: string;
  branchId: string;
  createdById: string;
  assigneeIds: string[];
}

export interface DispatchOptions {
  message: string;
  /** Who caused the event: excluded from every channel. */
  actorId?: string;
  addedAssigneeIds?: string[];
  removedAssigneeIds?: string[];
  mentionedUserIds?: string[];
  /** Left out of this event (e.g. the mentioned, who get MENTION instead). */
  excludeUserIds?: string[];
  /** Email per recipient; defaults to the generic ticket update email. */
  email?: (to: string) => MailJob;
}

/** Log context of every notification step (the name of the original service). */
export const NOTIFICATIONS_LOG_CONTEXT = 'TicketNotificationsService';

export const unique = (ids: string[]) => [...new Set(ids)];
