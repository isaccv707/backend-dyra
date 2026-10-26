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
  AUTO_CLOSE_BUSINESS_DAYS,
  ESCALATION_ROLE,
} from '../constants/ticket-lifecycle.const';
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
  SLA_WARNING: 'Ticket por vencer',
  ESCALATION: 'Ticket vencido sin asignar',
  AUTO_CLOSED: 'Tu ticket se cerró',
};

/** Extra text of the generic email, after the event's message. */
const EMAIL_FOOTERS: Partial<Record<TicketNotificationEvent, string>> = {
  RESOLVED: `Si el problema sigue, responde en el ticket: se reabrirá. Si no hay respuesta en ${AUTO_CLOSE_BUSINESS_DAYS} días hábiles se cerrará automáticamente.`,
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
}
