import { Injectable, Logger } from '@nestjs/common';
import { Ticket, TicketNotificationKind } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { MailQueueService } from 'src/mail/mail-queue.service';
import {
  AUTO_CLOSE_BUSINESS_DAYS,
  ESCALATION_ROLE,
} from '../../constants/ticket-lifecycle.const';
import { TicketsGateway } from '../../tickets.gateway';
import {
  assigneeIdsOf,
  CATEGORY_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_UPDATE_PERMISSION,
  TicketWithRelations,
} from '../../tickets.shared';
import {
  TICKET_NOTIFICATION_RULES,
  TicketAudience,
  TicketNotificationEvent,
} from '../ticket-notification-rules';
import {
  DispatchOptions,
  NOTIFICATIONS_LOG_CONTEXT,
  NotifiableTicket,
  unique,
} from '../ticket-notification.types';

/** Heading of the generic email, for events that send it. */
const EMAIL_HEADINGS: Partial<Record<TicketNotificationEvent, string>> = {
  RESOLVED: 'Tu ticket fue resuelto',
  FORM_DECIDED: 'Tu solicitud fue revisada',
  OVERDUE: 'Ticket con tiempo de atención vencido',
  SLA_WARNING: 'Ticket por vencer',
  ESCALATION: 'Ticket vencido sin asignar',
  AUTO_CLOSED: 'Tu ticket se cerró',
};

/** Extra text of the generic email, after the event's message. */
const EMAIL_FOOTERS: Partial<Record<TicketNotificationEvent, string>> = {
  RESOLVED: `Si el problema sigue, responde en el ticket: se reabrirá. Si no hay respuesta en ${AUTO_CLOSE_BUSINESS_DAYS} días hábiles se cerrará automáticamente.`,
};

/** Who gets each event (TICKET_NOTIFICATION_RULES): in-app notices and queued emails. */
@Injectable()
export class TicketNotificationDispatchService {
  private readonly logger = new Logger(NOTIFICATIONS_LOG_CONTEXT);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketsGateway: TicketsGateway,
    private readonly mailQueue: MailQueueService,
  ) {}

  /**
   * Sends an event's notices following TICKET_NOTIFICATION_RULES: in-app to
   * its inApp audiences, queued emails to its email audiences.
   */
  async dispatch(
    event: TicketNotificationEvent,
    ticket: NotifiableTicket,
    options: DispatchOptions,
  ) {
    const rule = TICKET_NOTIFICATION_RULES[event];
    const audiences = [...rule.inApp, ...rule.email];
    const needsTi =
      audiences.includes('tiStaff') ||
      (audiences.includes('assigneesOrTi') && ticket.assigneeIds.length === 0);
    const tiStaff = needsTi ? await this.findTiStaff(ticket.branchId) : [];
    const administrators = audiences.includes('administrators')
      ? await this.findAdministrators(ticket.branchId)
      : [];

    const tiIds = tiStaff.map((member) => member.id);
    const audienceIds: Record<TicketAudience, string[]> = {
      creator: [ticket.createdById],
      assignees: ticket.assigneeIds,
      tiStaff: tiIds,
      assigneesOrTi: ticket.assigneeIds.length > 0 ? ticket.assigneeIds : tiIds,
      administrators: administrators.map((admin) => admin.id),
      addedAssignees: options.addedAssigneeIds ?? [],
      removedAssignees: options.removedAssigneeIds ?? [],
      mentioned: options.mentionedUserIds ?? [],
    };
    const excluded = new Set([
      ...(options.actorId ? [options.actorId] : []),
      ...(options.excludeUserIds ?? []),
    ]);
    const recipients = (audiences: TicketAudience[]) =>
      unique(audiences.flatMap((audience) => audienceIds[audience])).filter(
        (id) => !excluded.has(id),
      );

    await this.notify(recipients(rule.inApp), ticket, {
      kind: rule.kind,
      message: options.message,
      actorId: options.actorId,
    });

    const emailIds = await this.withoutMutedEmails(
      event,
      recipients(rule.email),
    );
    if (emailIds.length === 0) return;

    const known = new Map(
      [...tiStaff, ...administrators].map((user) => [user.id, user.email]),
    );
    const missing = emailIds.filter((id) => !known.has(id));
    if (missing.length > 0) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: missing }, isActive: true },
        select: { id: true, email: true },
      });
      for (const user of users) known.set(user.id, user.email);
    }

    for (const id of emailIds) {
      const to = known.get(id);
      if (!to) continue;
      this.mailQueue.enqueue(
        options.email?.(to) ?? {
          type: 'ticketUpdate',
          to,
          data: {
            ticketId: ticket.id,
            code: ticket.code,
            title: ticket.title,
            heading: EMAIL_HEADINGS[event] ?? 'Novedades del ticket',
            message: [options.message, EMAIL_FOOTERS[event]]
              .filter(Boolean)
              .join('\n\n'),
          },
        },
      );
    }
  }

  /** Drops the users who turned this event's email off. */
  private async withoutMutedEmails(
    event: TicketNotificationEvent,
    userIds: string[],
  ) {
    if (userIds.length === 0) return userIds;
    const muted = await this.prisma.ticketEmailPreference.findMany({
      where: { userId: { in: userIds }, mutedEvents: { has: event } },
      select: { userId: true },
    });
    const mutedIds = new Set(muted.map((pref) => pref.userId));
    return userIds.filter((id) => !mutedIds.has(id));
  }

  /** Active users with ESCALATION_ROLE of the branch, or global. */
  private findAdministrators(branchId: string) {
    return this.prisma.user.findMany({
      where: {
        isActive: true,
        role: { name: ESCALATION_ROLE },
        OR: [
          { branches: { none: {} } },
          { branches: { some: { id: branchId } } },
        ],
      },
      select: { id: true, email: true },
    });
  }

  /** Active TI (tickets:update) of the branch, or global. */
  findTiStaff(branchId: string) {
    return this.prisma.user.findMany({
      where: {
        isActive: true,
        role: {
          permissions: { some: { action: TICKET_UPDATE_PERMISSION } },
        },
        OR: [
          { branches: { none: {} } },
          { branches: { some: { id: branchId } } },
        ],
      },
      select: { id: true, email: true },
    });
  }

  /** Saves an in-app notification per user and pushes it to their sockets. */
  async notify(
    userIds: (string | null | undefined)[],
    ticket: Pick<Ticket, 'id' | 'code' | 'title'>,
    notification: {
      kind: TicketNotificationKind;
      message: string;
      actorId?: string;
    },
  ) {
    const uniqueIds = [...new Set(userIds.filter((id): id is string => !!id))];

    if (uniqueIds.length > 0) {
      await this.prisma.ticketNotification.createMany({
        data: uniqueIds.map((userId) => ({
          userId,
          ticketId: ticket.id,
          ...notification,
        })),
      });
    }

    this.ticketsGateway.notifyUsers(uniqueIds, {
      ticketId: ticket.id,
      ticketCode: ticket.code,
      ticketTitle: ticket.title,
      kind: notification.kind,
      message: notification.message,
    });
  }

  /** NEW_TICKET notice. The ticket already exists: a failure is only logged. */
  async notifyNewTicket(ticket: TicketWithRelations, user: RequestUser) {
    try {
      await this.dispatch(
        'NEW_TICKET',
        { ...ticket, assigneeIds: assigneeIdsOf(ticket) },
        {
          message: `${user.name} levantó el ticket #${ticket.code} "${ticket.title}" en ${ticket.branch.name}.`,
          actorId: user.id,
          email: (to) => ({
            type: 'newTicket',
            to,
            data: {
              ticketId: ticket.id,
              code: ticket.code,
              title: ticket.title,
              categoryLabel: CATEGORY_LABELS[ticket.category],
              priorityLabel: TICKET_PRIORITY_LABELS[ticket.priority],
              branchName: ticket.branch.name,
              createdByName: user.name,
            },
          }),
        },
      );
    } catch (error) {
      this.logger.error(
        `No se pudo notificar el ticket nuevo #${ticket.code}: ${(error as Error).message}`,
      );
    }
  }
}
