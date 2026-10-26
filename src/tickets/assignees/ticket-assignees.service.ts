import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { assertBranchAccess } from 'src/common/utils/branch-access.util';
import { MailService } from 'src/mail/mail.service';
import { TicketCommentsService } from '../comments/ticket-comments.service';
import { FindAssignableUsersDto } from '../dto/find-assignable-users.dto';
import { SetTicketAssigneesDto } from '../dto/set-ticket-assignees.dto';
import { TicketsGateway } from '../tickets.gateway';
import {
  assigneeIdsOf,
  ChangeEntry,
  TICKET_PRIORITY_LABELS,
  ticketWithRelations,
} from '../tickets.shared';

@Injectable()
export class TicketAssigneesService {
  private readonly logger = new Logger(TicketAssigneesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketsGateway: TicketsGateway,
    private readonly mailService: MailService,
    private readonly comments: TicketCommentsService,
  ) {}

  async findAssignableUsers(
    id: string,
    dto: FindAssignableUsersDto,
    user: RequestUser,
  ) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      select: {
        branchId: true,
        createdById: true,
        assignees: { select: { userId: true } },
      },
    });
    if (!ticket) {
      throw new NotFoundException(`Ticket with ID '${id}' not found`);
    }
    assertBranchAccess(user, ticket.branchId);

    const search = dto.search?.trim();
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        id: { not: ticket.createdById },
        OR: [
          { branches: { none: {} } },
          { branches: { some: { id: ticket.branchId } } },
        ],
        ...(search && {
          AND: [
            {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            },
          ],
        }),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    });

    const assignedIds = new Set(ticket.assignees.map((a) => a.userId));
    return users.map((candidate) => ({
      ...candidate,
      isAssigned: assignedIds.has(candidate.id),
    }));
  }

  async setAssignees(
    id: string,
    dto: SetTicketAssigneesDto,
    user: RequestUser,
  ) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        branch: { select: { name: true } },
        assignees: {
          select: { userId: true, user: { select: { name: true } } },
        },
      },
    });
    if (!ticket) {
      throw new NotFoundException(`Ticket with ID '${id}' not found`);
    }
    assertBranchAccess(user, ticket.branchId);

    const currentIds = new Set(ticket.assignees.map((a) => a.userId));
    const desiredIds = new Set(dto.userIds);
    const addedIds = dto.userIds.filter((userId) => !currentIds.has(userId));
    const removed = ticket.assignees.filter((a) => !desiredIds.has(a.userId));

    const addedUsers = await this.assertAssigneesAreValid(addedIds, ticket);

    try {
      await this.prisma.$transaction([
        this.prisma.ticketAssignee.deleteMany({
          where: {
            ticketId: id,
            userId: { in: removed.map((a) => a.userId) },
          },
        }),
        this.prisma.ticketAssignee.createMany({
          data: addedIds.map((userId) => ({
            ticketId: id,
            userId,
            assignedById: user.id,
          })),
        }),
        ...(addedIds.length > 0 && !ticket.firstResponseAt
          ? [
              this.prisma.ticket.update({
                where: { id },
                data: { firstResponseAt: new Date() },
              }),
            ]
          : []),
      ]);
    } catch (error) {
      handleDatabaseErrors(error, 'Ticket');
    }

    const updated = await this.prisma.ticket.findUniqueOrThrow({
      where: { id },
      ...ticketWithRelations,
    });

    if (addedIds.length === 0 && removed.length === 0) return updated;

    const entries: ChangeEntry[] = [
      ...addedUsers.map((assignee) => ({
        type: 'ASSIGNED' as const,
        fromValue: null,
        toValue: assignee.id,
        text: `asignó el ticket a ${assignee.name}`,
      })),
      ...removed.map((assignee) => ({
        type: 'UNASSIGNED' as const,
        fromValue: assignee.userId,
        toValue: null,
        text: `quitó a ${assignee.user.name} del ticket`,
      })),
    ];

    await this.comments.recordChanges(
      ticket,
      entries,
      [ticket.createdById, ...assigneeIdsOf(updated)],
      user,
    );

    this.ticketsGateway.emitTicketUpdated(updated);

    for (const assignee of addedUsers) {
      this.mailService
        .sendTicketAssignedEmail(assignee.email, {
          ticketId: id,
          code: ticket.code,
          title: ticket.title,
          priorityLabel: TICKET_PRIORITY_LABELS[ticket.priority],
          branchName: ticket.branch.name,
          assignedByName: user.name,
        })
        .catch((error: unknown) => {
          this.logger.error(
            `No se pudo enviar el correo de asignación del ticket #${ticket.code} a ${assignee.email}: ${(error as Error).message}`,
          );
        });
    }

    return updated;
  }

  private async assertAssigneesAreValid(
    userIds: string[],
    ticket: { branchId: string; createdById: string },
  ) {
    if (userIds.length === 0) return [];

    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        branches: { select: { id: true } },
      },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return userIds.map((userId) => {
      const assignee = userMap.get(userId);

      if (!assignee) {
        throw new NotFoundException(`User with ID '${userId}' not found`);
      }
      if (userId === ticket.createdById) {
        throw new BadRequestException(
          'No se puede asignar el ticket a quien lo reportó',
        );
      }
      if (!assignee.isActive) {
        throw new BadRequestException(
          `El usuario ${assignee.name} no está activo`,
        );
      }
      if (
        assignee.branches.length > 0 &&
        !assignee.branches.some((b) => b.id === ticket.branchId)
      ) {
        throw new BadRequestException(
          `El usuario ${assignee.name} no tiene acceso a la sucursal de este ticket`,
        );
      }

      return assignee;
    });
  }
}
