import { Ticket } from '@prisma/client';
import { computeDueAt } from '../constants/ticket-sla.const';
import {
  addBusinessTime,
  businessTimeBetween,
} from '../constants/business-hours';
import { UpdateTicketDto } from '../dto/update-ticket.dto';
import { REOPENABLE_STATUSES } from '../tickets.shared';

export interface TraceabilityFields {
  resolvedAt?: Date | null;
  closedAt?: Date | null;
  reopenedCount?: number;
  dueAt?: Date | null;
  overdueNotifiedAt?: Date | null;
  firstResponseAt?: Date;
  onHoldSince?: Date | null;
  slaPausedSeconds?: number;
}

/** Lifecycle and SLA columns that change with a status or priority change. */
export function computeTraceabilityFields(
  ticket: Ticket,
  dto: Pick<UpdateTicketDto, 'status' | 'priority'>,
): TraceabilityFields {
  const data: TraceabilityFields = {};
  const now = new Date();
  let pausedSeconds = ticket.slaPausedSeconds ?? 0;
  let dueAt = ticket.dueAt;

  // The SLA does not run while waiting (ON_HOLD): the business time spent
  // on hold moves dueAt.
  if (dto.status && dto.status !== ticket.status) {
    if (dto.status === 'ON_HOLD') {
      data.onHoldSince = now;
    } else if (ticket.status === 'ON_HOLD' && ticket.onHoldSince) {
      const pausedMs = businessTimeBetween(ticket.onHoldSince, now);
      pausedSeconds += Math.round(pausedMs / 1000);
      data.slaPausedSeconds = pausedSeconds;
      data.onHoldSince = null;
      if (dueAt) {
        dueAt = addBusinessTime(dueAt, pausedMs);
        data.dueAt = dueAt;
        if (dueAt > now) data.overdueNotifiedAt = null;
      }
    }
  }

  if (dto.status && dto.status !== ticket.status) {
    if (dto.status === 'RESOLVED') {
      data.resolvedAt = new Date();
    }
    if (dto.status === 'CLOSED') {
      data.closedAt = new Date();
      if (!ticket.resolvedAt) data.resolvedAt = new Date();
    }
    if (
      dto.status === 'IN_PROGRESS' &&
      REOPENABLE_STATUSES.includes(ticket.status)
    ) {
      data.resolvedAt = null;
      data.closedAt = null;
      data.reopenedCount = ticket.reopenedCount + 1;
      data.overdueNotifiedAt = null;
    }
  }

  if (dto.priority && dto.priority !== ticket.priority) {
    data.dueAt = computeDueAt(
      dto.priority,
      ticket.createdAt,
      pausedSeconds * 1000,
    );
    data.overdueNotifiedAt = null;
  }

  return data;
}
