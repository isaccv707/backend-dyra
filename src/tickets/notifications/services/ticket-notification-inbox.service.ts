import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import {
  buildPaginatedQuery,
  paginatedResponse,
} from 'src/common/utils/paginate.util';
import { FindTicketNotificationsDto } from '../../dto/find-ticket-notifications.dto';

/** Read notifications are deleted after this many days (unread ones stay). */
export const NOTIFICATION_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The user's own notices: list, read, delete, and the retention cleanup. */
@Injectable()
export class TicketNotificationInboxService {
  constructor(private readonly prisma: PrismaService) {}

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
