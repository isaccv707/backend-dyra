import { TicketPriority } from '@prisma/client';
import { addBusinessTime } from './business-hours';

/** Business hours (see BUSINESS_HOURS) to attend a ticket, by priority. */
export const SLA_HOURS_BY_PRIORITY: Record<TicketPriority, number> = {
  CRITICAL: 4,
  HIGH: 8,
  MEDIUM: 24,
  LOW: 72,
};

const HOUR_MS = 60 * 60 * 1000;

/**
 * Deadline counting only business hours from `from`, plus `pausedMs` of
 * business time the ticket spent ON_HOLD.
 */
export function computeDueAt(
  priority: TicketPriority,
  from: Date,
  pausedMs = 0,
): Date {
  return addBusinessTime(
    from,
    SLA_HOURS_BY_PRIORITY[priority] * HOUR_MS + pausedMs,
  );
}
