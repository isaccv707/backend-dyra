import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Ticket } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { CreateTicketCommentDto } from '../dto/create-ticket-comment.dto';
import { TicketNotificationsService } from '../notifications/ticket-notifications.service';
import { TicketsGateway } from '../tickets.gateway';
import {
  ChangeEntry,
  commentWithAuthor,
  notificationKindOf,
} from '../tickets.shared';
import { assertTicketAccess } from '../utils/ticket-access.util';

const COMMENT_PREVIEW_LENGTH = 140;

@Injectable()
export class TicketCommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketsGateway: TicketsGateway,
    private readonly notifications: TicketNotificationsService,
  ) {}

  async addComment(
    ticketId: string,
    dto: CreateTicketCommentDto,
    user: RequestUser,
  ) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { assignees: { select: { userId: true } } },
    });
    if (!ticket) {
      throw new NotFoundException(`Ticket with ID '${ticketId}' not found`);
    }

    const assigneeIds = ticket.assignees.map((a) => a.userId);
    const canSeeAllTickets = assertTicketAccess(ticket, assigneeIds, user);

    if (dto.isInternal && !canSeeAllTickets) {
      throw new ForbiddenException(
        'No tienes permiso para crear notas internas',
      );
    }

    const comment = await this.prisma.ticketComment.create({
      data: {
        body: dto.body,
        isInternal: dto.isInternal ?? false,
        ticketId,
        authorId: user.id,
      },
      ...commentWithAuthor,
    });

    await this.prisma.ticketEvent.create({
      data: {
        type: 'COMMENTED',
        ticketId,
        actorId: user.id,
        toValue: comment.isInternal ? 'internal' : 'public',
      },
    });

    if (!ticket.firstResponseAt && user.id !== ticket.createdById) {
      await this.prisma.ticket.update({
        where: { id: ticketId },
        data: { firstResponseAt: new Date() },
      });
    }

    this.ticketsGateway.emitNewComment(ticket, comment, [
      ticket.createdById,
      ...assigneeIds,
    ]);

    if (!comment.isInternal) {
      const preview =
        dto.body.length > COMMENT_PREVIEW_LENGTH
          ? `${dto.body.slice(0, COMMENT_PREVIEW_LENGTH)}…`
          : dto.body;

      await this.notifications.notify(
        [ticket.createdById, ...assigneeIds].filter((id) => id !== user.id),
        ticket,
        {
          kind: 'COMMENT',
          message: `${user.name} comentó: ${preview}`,
          actorId: user.id,
        },
      );
    }

    return comment;
  }

  /**
   * Records changes as one system comment plus a TicketEvent each, and
   * notifies the recipients except the actor.
   */
  async recordChanges(
    ticket: Pick<Ticket, 'id' | 'branchId' | 'code' | 'title'>,
    entries: ChangeEntry[],
    recipientIds: string[],
    user: RequestUser,
  ) {
    if (entries.length === 0) return;
    const ticketId = ticket.id;

    const message = `${user.name} ${entries.map((e) => e.text).join(', ')}.`;

    const comment = await this.prisma.ticketComment.create({
      data: {
        body: message,
        isInternal: false,
        isSystem: true,
        ticketId,
        authorId: user.id,
      },
      ...commentWithAuthor,
    });

    await this.prisma.ticketEvent.createMany({
      data: entries.map((entry) => ({
        type: entry.type,
        fromValue: entry.fromValue,
        toValue: entry.toValue,
        ticketId,
        actorId: user.id,
      })),
    });

    this.ticketsGateway.emitNewComment(ticket, comment, recipientIds);
    // The actor already knows what they did: no notification for them.
    await this.notifications.notify(
      recipientIds.filter((id) => id !== user.id),
      ticket,
      { kind: notificationKindOf(entries), message, actorId: user.id },
    );
  }
}
