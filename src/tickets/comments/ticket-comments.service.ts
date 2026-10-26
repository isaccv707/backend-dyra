import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { CreateTicketCommentDto } from '../dto/create-ticket-comment.dto';
import {
  DispatchOptions,
  NotifiableTicket,
  TicketNotificationsService,
} from '../notifications/ticket-notifications.service';
import { TicketNotificationEvent } from '../notifications/ticket-notification-rules';
import { TicketsGateway } from '../tickets.gateway';
import { ChangeEntry, commentWithAuthor } from '../tickets.shared';
import { assertTicketAccess } from '../utils/ticket-access.util';

const COMMENT_PREVIEW_LENGTH = 140;

/** Notice event of a batch of changes (one system comment). */
export const changeEventOf = (
  entries: ChangeEntry[],
): TicketNotificationEvent => {
  if (
    entries.some((e) => e.type === 'FORM_APPLIED' || e.type === 'FORM_REJECTED')
  ) {
    return 'FORM_DECIDED';
  }
  if (entries.some((e) => e.type.startsWith('FORM_'))) return 'FORM_UPDATED';
  if (entries.some((e) => e.type === 'ASSIGNED' || e.type === 'UNASSIGNED')) {
    return 'ASSIGNMENT';
  }
  if (
    entries.some((e) => e.type === 'STATUS_CHANGED' && e.toValue === 'RESOLVED')
  ) {
    return 'RESOLVED';
  }
  return 'CHANGE';
};

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

    const preview =
      dto.body.length > COMMENT_PREVIEW_LENGTH
        ? `${dto.body.slice(0, COMMENT_PREVIEW_LENGTH)}…`
        : dto.body;

    await this.notifications.dispatch(
      comment.isInternal ? 'INTERNAL_NOTE' : 'COMMENT',
      { ...ticket, assigneeIds },
      {
        message: `${user.name} ${comment.isInternal ? 'agregó una nota interna' : 'comentó'}: ${preview}`,
        actorId: user.id,
      },
    );

    return comment;
  }

  /**
   * Records changes as one system comment plus a TicketEvent each, and sends
   * the notices of their event (changeEventOf).
   */
  async recordChanges(
    ticket: NotifiableTicket,
    entries: ChangeEntry[],
    user: RequestUser,
    options: Pick<
      DispatchOptions,
      'addedAssigneeIds' | 'removedAssigneeIds' | 'email'
    > = {},
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

    this.ticketsGateway.emitNewComment(ticket, comment, [
      ticket.createdById,
      ...ticket.assigneeIds,
    ]);
    await this.notifications.dispatch(changeEventOf(entries), ticket, {
      ...options,
      message,
      actorId: user.id,
    });
  }
}
