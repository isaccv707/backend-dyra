import { Injectable, Logger } from '@nestjs/common';
import { Prisma, TicketStatus } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { TicketCommentsService } from '../comments/ticket-comments.service';
import {
  addBusinessDays,
  businessTimeBetween,
} from '../constants/business-hours';
import {
  AUTO_CLOSE_BUSINESS_DAYS,
  ESCALATION_BUSINESS_HOURS,
  SLA_WARNING_RATIO,
} from '../constants/ticket-lifecycle.const';
import { SLA_HOURS_BY_PRIORITY } from '../constants/ticket-sla.const';
import { TicketNotificationsService } from '../notifications/ticket-notifications.service';
import { TicketsGateway } from '../tickets.gateway';
import { TICKET_STATUS_LABELS, ticketWithRelations } from '../tickets.shared';
import { computeTraceabilityFields } from '../utils/ticket-traceability.util';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Statuses whose SLA is running (ON_HOLD pauses it; dueAt moves on resume). */
const SLA_RUNNING_STATUSES: TicketStatus[] = ['OPEN', 'IN_PROGRESS'];

const slaTicketSelect = {
  id: true,
  code: true,
  title: true,
  branchId: true,
  createdById: true,
  priority: true,
  dueAt: true,
  assignees: { select: { userId: true } },
} satisfies Prisma.TicketSelect;

/**
 * Time-driven ticket lifecycle, run by TicketsSlaCron. Every step claims the
 * ticket with a conditional update first, so with several instances only one
 * acts on each ticket.
 */
@Injectable()
export class TicketSlaService {
  private readonly logger = new Logger(TicketSlaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketsGateway: TicketsGateway,
    private readonly notifications: TicketNotificationsService,
    private readonly comments: TicketCommentsService,
  ) {}

  /** SLA_WARNING_RATIO of the SLA used: warn whoever must act. */
  async warnSlaAboutToExpire(now = new Date()): Promise<{ warned: number }> {
    const candidates = await this.prisma.ticket.findMany({
      where: {
        status: { in: SLA_RUNNING_STATUSES },
        slaWarnedAt: null,
        // The longest SLA (72 business h) fits in two calendar weeks.
        dueAt: { gt: now, lt: new Date(now.getTime() + 14 * DAY_MS) },
      },
      select: slaTicketSelect,
    });

    let warned = 0;
    for (const ticket of candidates) {
      const slaMs = SLA_HOURS_BY_PRIORITY[ticket.priority] * HOUR_MS;
      const remainingMs = businessTimeBetween(now, ticket.dueAt!);
      if (remainingMs > slaMs * (1 - SLA_WARNING_RATIO)) continue;

      const { count } = await this.prisma.ticket.updateMany({
        where: { id: ticket.id, slaWarnedAt: null },
        data: { slaWarnedAt: now },
      });
      if (count === 0) continue;
      warned++;

      const hours = Math.max(1, Math.round(remainingMs / HOUR_MS));
      await this.notifications.dispatch(
        'SLA_WARNING',
        { ...ticket, assigneeIds: ticket.assignees.map((a) => a.userId) },
        {
          message: `El ticket #${ticket.code} "${ticket.title}" vence en ~${hours} h hábil(es).`,
        },
      );
    }
    return { warned };
  }

  async notifyOverdueTickets(now = new Date()): Promise<{ notified: number }> {
    const overdue = await this.prisma.ticket.findMany({
      where: {
        dueAt: { lt: now },
        overdueNotifiedAt: null,
        status: { in: SLA_RUNNING_STATUSES },
      },
      select: slaTicketSelect,
    });

    let notified = 0;
    for (const ticket of overdue) {
      const { count } = await this.prisma.ticket.updateMany({
        where: { id: ticket.id, overdueNotifiedAt: null },
        data: { overdueNotifiedAt: now },
      });
      if (count === 0) continue;
      notified++;

      await this.notifications.dispatch(
        'OVERDUE',
        { ...ticket, assigneeIds: ticket.assignees.map((a) => a.userId) },
        {
          message: `El ticket #${ticket.code} "${ticket.title}" venció su tiempo de atención (SLA).`,
        },
      );
      this.ticketsGateway.emitOverdueTicket({
        id: ticket.id,
        code: ticket.code,
        title: ticket.title,
        branchId: ticket.branchId,
      });
    }
    return { notified };
  }

  /** Overdue and nobody assigned for ESCALATION_BUSINESS_HOURS: tell the administrators. */
  async escalateUnassignedOverdue(
    now = new Date(),
  ): Promise<{ escalated: number }> {
    const candidates = await this.prisma.ticket.findMany({
      where: {
        status: { in: SLA_RUNNING_STATUSES },
        escalatedAt: null,
        dueAt: { lt: now },
        assignees: { none: {} },
      },
      select: slaTicketSelect,
    });

    let escalated = 0;
    for (const ticket of candidates) {
      const overdueMs = businessTimeBetween(ticket.dueAt!, now);
      if (overdueMs < ESCALATION_BUSINESS_HOURS * HOUR_MS) continue;

      const { count } = await this.prisma.ticket.updateMany({
        where: { id: ticket.id, escalatedAt: null, assignees: { none: {} } },
        data: { escalatedAt: now },
      });
      if (count === 0) continue;
      escalated++;

      await this.notifications.dispatch(
        'ESCALATION',
        { ...ticket, assigneeIds: [] },
        {
          message: `El ticket #${ticket.code} "${ticket.title}" lleva más de ${ESCALATION_BUSINESS_HOURS} h hábiles vencido y sin asignar.`,
        },
      );
    }
    return { escalated };
  }

  /** RESOLVED with no reply from the requester for AUTO_CLOSE_BUSINESS_DAYS: close it. */
  async autoCloseResolved(now = new Date()): Promise<{ closed: number }> {
    const candidates = await this.prisma.ticket.findMany({
      where: {
        status: 'RESOLVED',
        // Business days are at least calendar days: a cheap lower bound.
        resolvedAt: {
          lte: new Date(now.getTime() - AUTO_CLOSE_BUSINESS_DAYS * DAY_MS),
        },
      },
    });

    let closed = 0;
    for (const ticket of candidates) {
      if (addBusinessDays(ticket.resolvedAt!, AUTO_CLOSE_BUSINESS_DAYS) > now) {
        continue;
      }

      const { count } = await this.prisma.ticket.updateMany({
        where: { id: ticket.id, status: 'RESOLVED' },
        data: {
          status: 'CLOSED',
          ...computeTraceabilityFields(ticket, { status: 'CLOSED' }),
        },
      });
      if (count === 0) continue;
      closed++;

      try {
        const updated = await this.prisma.ticket.findUniqueOrThrow({
          where: { id: ticket.id },
          ...ticketWithRelations,
        });
        await this.comments.recordChanges(
          {
            ...ticket,
            assigneeIds: updated.assignees.map((a) => a.user.id),
          },
          [
            {
              type: 'STATUS_CHANGED',
              fromValue: 'RESOLVED',
              toValue: 'CLOSED',
              text: `se cerró automáticamente ("${TICKET_STATUS_LABELS.RESOLVED}" → "${TICKET_STATUS_LABELS.CLOSED}") tras ${AUTO_CLOSE_BUSINESS_DAYS} días hábiles sin respuesta`,
            },
          ],
          null,
          { event: 'AUTO_CLOSED' },
        );
        this.ticketsGateway.emitTicketUpdated(updated);
      } catch (error) {
        this.logger.error(
          `No se pudo registrar el cierre automático del ticket #${ticket.code}: ${(error as Error).message}`,
        );
      }
    }
    return { closed };
  }
}
