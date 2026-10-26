import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Ticket, TicketNotificationKind } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import {
  buildPaginatedQuery,
  paginatedResponse,
} from 'src/common/utils/paginate.util';
import { MailJob, MailQueueService } from 'src/mail/mail-queue.service';
import { FindTicketNotificationsDto } from '../dto/find-ticket-notifications.dto';
import { TicketsGateway } from '../tickets.gateway';
import {
  assigneeIdsOf,
  CATEGORY_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_UPDATE_PERMISSION,
  TicketWithRelations,
} from '../tickets.shared';
import {
  TICKET_NOTIFICATION_RULES,
  TicketAudience,
  TicketNotificationEvent,
} from './ticket-notification-rules';

/** Read notifications are deleted after this many days (unread ones stay). */
export const NOTIFICATION_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

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
  /** Email per recipient; defaults to the generic ticket update email. */
  email?: (to: string) => MailJob;
}

/** Heading of the generic email, for events that send it. */
const EMAIL_HEADINGS: Partial<Record<TicketNotificationEvent, string>> = {
  RESOLVED: 'Tu ticket fue resuelto',
  FORM_DECIDED: 'Tu solicitud fue revisada',
  OVERDUE: 'Ticket con tiempo de atención vencido',
};

const unique = (ids: string[]) => [...new Set(ids)];

@Injectable()
export class TicketNotificationsService {
  private readonly logger = new Logger(TicketNotificationsService.name);

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
    const needsTi = [...rule.inApp, ...rule.email].includes('tiStaff');
    const tiStaff = needsTi ? await this.findTiStaff(ticket.branchId) : [];

    const audienceIds: Record<TicketAudience, string[]> = {
      creator: [ticket.createdById],
      assignees: ticket.assigneeIds,
      tiStaff: tiStaff.map((member) => member.id),
      addedAssignees: options.addedAssigneeIds ?? [],
      removedAssignees: options.removedAssigneeIds ?? [],
    };
    const recipients = (audiences: TicketAudience[]) =>
      unique(audiences.flatMap((audience) => audienceIds[audience])).filter(
        (id) => id !== options.actorId,
      );

    await this.notify(recipients(rule.inApp), ticket, {
      kind: rule.kind,
      message: options.message,
      actorId: options.actorId,
    });

    const emailIds = recipients(rule.email);
    if (emailIds.length === 0) return;

    const known = new Map(tiStaff.map((member) => [member.id, member.email]));
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
            message: options.message,
          },
        },
      );
    }
  }

  /** Active TI (tickets:update) of the branch, or global. */
  private findTiStaff(branchId: string) {
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

  async findMine(dto: FindTicketNotificationsDto, user: RequestUser) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['message'],
      defaultSort: { createdAt: 'desc' },
      allowedFields: ['createdAt', 'read'],
    });

    const finalWhere = {
      ...where,
      userId: user.id,
      ...(dto.read !== undefined && { read: dto.read }),
    } as Prisma.TicketNotificationWhereInput;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.ticketNotification.findMany({
        skip,
        take,
        where: finalWhere,
        orderBy,
        include: {
          ticket: {
            select: {
              code: true,
              title: true,
              status: true,
              category: true,
              branch: { select: { id: true, name: true } },
            },
          },
          actor: { select: { id: true, name: true } },
        },
      }),
      this.prisma.ticketNotification.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async markRead(id: string, user: RequestUser) {
    const notification = await this.prisma.ticketNotification.findUnique({
      where: { id },
    });
    if (!notification) {
      throw new NotFoundException(`Notification with ID '${id}' not found`);
    }
    if (notification.userId !== user.id) {
      throw new ForbiddenException('Esta notificación no te pertenece');
    }

    return this.prisma.ticketNotification.update({
      where: { id },
      data: { read: true },
    });
  }

  async markAllRead(user: RequestUser) {
    const { count } = await this.prisma.ticketNotification.updateMany({
      where: { userId: user.id, read: false },
      data: { read: true },
    });

    return { updated: count };
  }

  async remove(id: string, user: RequestUser) {
    const notification = await this.prisma.ticketNotification.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!notification) {
      throw new NotFoundException(`Notification with ID '${id}' not found`);
    }
    if (notification.userId !== user.id) {
      throw new ForbiddenException('Esta notificación no te pertenece');
    }
    await this.prisma.ticketNotification.delete({ where: { id } });
    return { deleted: 1 };
  }

  /** The user clears their own list: the read ones, or all with `all`. */
  async purgeMine(user: RequestUser, all = false) {
    const { count } = await this.prisma.ticketNotification.deleteMany({
      where: { userId: user.id, ...(!all && { read: true }) },
    });
    return { deleted: count };
  }

  /** Housekeeping (cron): read notifications older than the retention window. */
  async purgeOld(now = new Date()) {
    const { count } = await this.prisma.ticketNotification.deleteMany({
      where: {
        read: true,
        createdAt: {
          lt: new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * DAY_MS),
        },
      },
    });
    return { deleted: count };
  }

  async notifyOverdueTickets(): Promise<{ notified: number }> {
    const now = new Date();
    const overdue = await this.prisma.ticket.findMany({
      where: {
        dueAt: { lt: now },
        overdueNotifiedAt: null,
        // ON_HOLD pauses the SLA (dueAt moves when it resumes).
        status: { notIn: ['ON_HOLD', 'RESOLVED', 'CLOSED', 'CANCELLED'] },
      },
      select: {
        id: true,
        code: true,
        title: true,
        branchId: true,
        createdById: true,
        assignees: { select: { userId: true } },
      },
    });

    let notified = 0;
    for (const ticket of overdue) {
      // Claim first: with several instances only one notifies each ticket.
      const { count } = await this.prisma.ticket.updateMany({
        where: { id: ticket.id, overdueNotifiedAt: null },
        data: { overdueNotifiedAt: now },
      });
      if (count === 0) continue;
      notified++;

      const message = `El ticket #${ticket.code} "${ticket.title}" venció su tiempo de atención (SLA).`;

      await this.dispatch(
        'OVERDUE',
        { ...ticket, assigneeIds: ticket.assignees.map((a) => a.userId) },
        { message },
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
}
