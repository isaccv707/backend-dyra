import { TicketPriority } from '@prisma/client';

export const SLA_HOURS_BY_PRIORITY: Record<TicketPriority, number> = {
  CRITICAL: 4,
  HIGH: 8,
  MEDIUM: 24,
  LOW: 72,
};

export function computeDueAt(priority: TicketPriority, from: Date): Date {
  const hours = SLA_HOURS_BY_PRIORITY[priority];
  return new Date(from.getTime() + hours * 60 * 60 * 1000);
}
