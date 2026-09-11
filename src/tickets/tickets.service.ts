import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Ticket, TicketPriority, TicketStatus } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import {
  assertBranchAccess,
  BranchScopedUser,
  userBranchFilter,
} from 'src/common/utils/branch-access.util';
import {
  buildPaginatedQuery,
  paginatedResponse,
} from 'src/common/utils/paginate.util';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { CreateTicketCommentDto } from './dto/create-ticket-comment.dto';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { FindTicketNotificationsDto } from './dto/find-ticket-notifications.dto';
import { FindTicketsDto } from './dto/find-tickets.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { TicketsGateway } from './tickets.gateway';

const TICKET_ALLOWED_FIELDS = [
  'code',
  'title',
  'status',
  'priority',
  'category',
  'createdAt',
];

const TICKET_UPDATE_PERMISSION = 'tickets:update';

const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  OPEN: 'Abierto',
  IN_PROGRESS: 'En progreso',
  ON_HOLD: 'En espera',
  RESOLVED: 'Resuelto',
  CLOSED: 'Cerrado',
  CANCELLED: 'Cancelado',
};

// Transiciones válidas de estado. OPEN puede resolverse directo (arreglos
// rápidos no necesitan pasar por IN_PROGRESS); RESOLVED y CLOSED se pueden
// reabrir a IN_PROGRESS si el problema reaparece; CANCELLED es terminal.
const TICKET_STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CANCELLED'],
  IN_PROGRESS: ['ON_HOLD', 'RESOLVED', 'CANCELLED'],
  ON_HOLD: ['IN_PROGRESS', 'CANCELLED'],
  RESOLVED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: ['IN_PROGRESS'],
  CANCELLED: [],
};

const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  CRITICAL: 'Crítica',
};

const COMMENT_PREVIEW_LENGTH = 140;

const ticketWithRelations = Prisma.validator<Prisma.TicketDefaultArgs>()({
  include: {
    branch: { select: { id: true, name: true } },
    createdBy: { select: { id: true, name: true, email: true } },
    assignedTo: { select: { id: true, name: true, email: true } },
  },
});

export type TicketWithRelations = Prisma.TicketGetPayload<
  typeof ticketWithRelations
>;

const commentWithAuthor = Prisma.validator<Prisma.TicketCommentDefaultArgs>()({
  include: {
    author: { select: { id: true, name: true, email: true } },
  },
});

export type TicketCommentWithAuthor = Prisma.TicketCommentGetPayload<
  typeof commentWithAuthor
>;

const ticketWithFullRelations = Prisma.validator<Prisma.TicketDefaultArgs>()({
  include: {
    ...ticketWithRelations.include,
    comments: {
      orderBy: { createdAt: 'asc' },
      ...commentWithAuthor,
    },
  },
});

export type TicketWithFullRelations = Prisma.TicketGetPayload<
  typeof ticketWithFullRelations
>;

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketsGateway: TicketsGateway,
  ) {}

  async create(
    createTicketDto: CreateTicketDto,
    user: BranchScopedUser & { id: string },
  ) {
    assertBranchAccess(user, createTicketDto.branchId);

    try {
      const ticket = await this.prisma.ticket.create({
        data: {
          ...createTicketDto,
          createdById: user.id,
        },
        ...ticketWithRelations,
      });

      this.ticketsGateway.emitNewTicket(ticket);

      return ticket;
    } catch (error) {
      handleDatabaseErrors(error, 'Ticket');
    }
  }

  private hasTicketUpdatePermission(user: RequestUser): boolean {
    return user.role.permissions.includes(TICKET_UPDATE_PERMISSION);
  }

  // Punto único de autorización para operar sobre un ticket ya existente
  // (verlo, comentarlo, adjuntar). Con tickets:update (TI) el criterio sigue
  // siendo de sucursal, como siempre. Sin ese permiso, el criterio es
  // exclusivamente "eres quien lo creó" — deliberadamente *sin* pasar por
  // assertBranchAccess: el reportero conserva el control de todo lo que ha
  // levantado aunque después lo reasignen a otra sucursal (o deje de estar
  // asignado a la sucursal donde lo reportó).
  private assertTicketAccess(
    ticket: { branchId: string; createdById: string },
    user: RequestUser,
  ): boolean {
    const canSeeAllTickets = this.hasTicketUpdatePermission(user);

    if (canSeeAllTickets) {
      assertBranchAccess(user, ticket.branchId);
    } else if (ticket.createdById !== user.id) {
      throw new ForbiddenException('No tienes acceso a este ticket');
    }

    return canSeeAllTickets;
  }

  async findAll(dto: FindTicketsDto, user: RequestUser) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['title', 'description'],
      defaultSort: { createdAt: 'desc' },
      allowedFields: TICKET_ALLOWED_FIELDS,
    });

    // Sin tickets:update (personal de TI), el usuario solo ve su propio
    // histórico de reportes — nunca los tickets de otros, aunque compartan
    // sucursal. Ese histórico tampoco se filtra por sucursal: es "todos los
    // tickets que este usuario ha levantado", sin importar en qué sucursal
    // los reportó ni a cuáles esté asignado ahora. branchId como query param
    // sigue aceptándose como un filtro más sobre ese histórico, no como una
    // restricción de acceso.
    const canSeeAllTickets = this.hasTicketUpdatePermission(user);

    const finalWhere = {
      ...where,
      ...(canSeeAllTickets
        ? userBranchFilter(user, dto.branchId)
        : dto.branchId && { branchId: dto.branchId }),
      ...(dto.status && { status: dto.status }),
      ...(dto.category && { category: dto.category }),
      ...(dto.priority && { priority: dto.priority }),
      ...(dto.assignedToId && { assignedToId: dto.assignedToId }),
      ...(!canSeeAllTickets && { createdById: user.id }),
    } as Prisma.TicketWhereInput;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.ticket.findMany({
        skip,
        take,
        where: finalWhere,
        orderBy,
        ...ticketWithRelations,
      }),
      this.prisma.ticket.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOne(id: string, user: RequestUser) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      ...ticketWithFullRelations,
    });
    if (!ticket) {
      throw new NotFoundException(`Ticket with ID '${id}' not found`);
    }

    const canSeeAllTickets = this.assertTicketAccess(ticket, user);

    return {
      ...ticket,
      comments: canSeeAllTickets
        ? ticket.comments
        : ticket.comments.filter((comment) => !comment.isInternal),
    };
  }

  async update(
    id: string,
    updateTicketDto: UpdateTicketDto,
    user: RequestUser,
  ) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) {
      throw new NotFoundException(`Ticket with ID '${id}' not found`);
    }
    assertBranchAccess(user, ticket.branchId);

    if (updateTicketDto.status && updateTicketDto.status !== ticket.status) {
      this.assertValidStatusTransition(ticket.status, updateTicketDto.status);
    }

    if (updateTicketDto.assignedToId) {
      await this.assertAssigneeIsValid(
        updateTicketDto.assignedToId,
        ticket.branchId,
      );
    }

    try {
      const updated = await this.prisma.ticket.update({
        where: { id },
        data: {
          ...(updateTicketDto.status && { status: updateTicketDto.status }),
          ...(updateTicketDto.priority && {
            priority: updateTicketDto.priority,
          }),
          ...(updateTicketDto.assignedToId !== undefined && {
            assignedToId: updateTicketDto.assignedToId,
          }),
        },
        ...ticketWithRelations,
      });

      await this.recordChangeAndNotify(ticket, updated, updateTicketDto, user);

      this.ticketsGateway.emitTicketUpdated(updated);

      return updated;
    } catch (error) {
      handleDatabaseErrors(error, 'Ticket');
    }
  }

  async addComment(
    ticketId: string,
    dto: CreateTicketCommentDto,
    user: RequestUser,
  ) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) {
      throw new NotFoundException(`Ticket with ID '${ticketId}' not found`);
    }

    const canSeeAllTickets = this.assertTicketAccess(ticket, user);

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

    this.ticketsGateway.emitNewComment(ticketId, comment);

    // Las notas internas solo le importan a TI (ya llegan por
    // emitNewComment a ti_staff_room) — un comentario público sí debe
    // avisarle a quien reportó el ticket y a quien lo tiene asignado.
    if (!comment.isInternal) {
      const preview =
        dto.body.length > COMMENT_PREVIEW_LENGTH
          ? `${dto.body.slice(0, COMMENT_PREVIEW_LENGTH)}…`
          : dto.body;

      await this.persistAndNotify(
        [ticket.createdById, ticket.assignedToId].filter(
          (id) => id !== user.id,
        ),
        ticketId,
        `${user.name} comentó: ${preview}`,
      );
    }

    return comment;
  }

  // Deja un comentario de sistema (isSystem:true) con lo que cambió en este
  // update() — es el historial de auditoría: quién reasignó, quién cambió
  // estado/prioridad y cuándo, sin depender de que además haya escrito un
  // comentario. También avisa en vivo a quien reportó el ticket y a quien
  // quedó asignado (si cambió) — no solo a ti_staff_room.
  private async recordChangeAndNotify(
    previousTicket: Pick<
      Ticket,
      'id' | 'status' | 'priority' | 'assignedToId' | 'createdById'
    >,
    updatedTicket: TicketWithRelations,
    dto: UpdateTicketDto,
    user: RequestUser,
  ) {
    const summary = this.buildChangeSummary(previousTicket, updatedTicket, dto);
    if (!summary) return;

    const message = `${user.name} ${summary}`;

    const comment = await this.prisma.ticketComment.create({
      data: {
        body: message,
        isInternal: false,
        isSystem: true,
        ticketId: previousTicket.id,
        authorId: user.id,
      },
      ...commentWithAuthor,
    });

    this.ticketsGateway.emitNewComment(previousTicket.id, comment);
    await this.persistAndNotify(
      [previousTicket.createdById, updatedTicket.assignedToId],
      previousTicket.id,
      message,
    );
  }

  private buildChangeSummary(
    previousTicket: Pick<Ticket, 'status' | 'priority' | 'assignedToId'>,
    updatedTicket: TicketWithRelations,
    dto: UpdateTicketDto,
  ): string | null {
    const parts: string[] = [];

    if (dto.status && dto.status !== previousTicket.status) {
      parts.push(
        `cambió el estado de "${TICKET_STATUS_LABELS[previousTicket.status]}" a "${TICKET_STATUS_LABELS[updatedTicket.status]}"`,
      );
    }

    if (dto.priority && dto.priority !== previousTicket.priority) {
      parts.push(
        `cambió la prioridad de "${TICKET_PRIORITY_LABELS[previousTicket.priority]}" a "${TICKET_PRIORITY_LABELS[updatedTicket.priority]}"`,
      );
    }

    if (
      dto.assignedToId !== undefined &&
      dto.assignedToId !== previousTicket.assignedToId
    ) {
      parts.push(
        updatedTicket.assignedTo
          ? `reasignó el ticket a ${updatedTicket.assignedTo.name}`
          : 'quitó la asignación del ticket',
      );
    }

    return parts.length ? `${parts.join(', ')}.` : null;
  }

  private assertValidStatusTransition(from: TicketStatus, to: TicketStatus) {
    if (!TICKET_STATUS_TRANSITIONS[from].includes(to)) {
      throw new BadRequestException(
        `No se puede cambiar el estado de "${TICKET_STATUS_LABELS[from]}" a "${TICKET_STATUS_LABELS[to]}"`,
      );
    }
  }

  // El responsable asignado debe ser un usuario activo, con permiso
  // tickets:update (es quien va a resolver tickets, no cualquier usuario del
  // sistema) y con acceso a la sucursal del ticket — mismo criterio que
  // assertBranchAccess pero evaluado sobre el asignado, no sobre quien hace
  // la petición.
  private async assertAssigneeIsValid(assignedToId: string, branchId: string) {
    const assignee = await this.prisma.user.findUnique({
      where: { id: assignedToId },
      select: {
        isActive: true,
        branches: { select: { id: true } },
        role: { select: { permissions: { select: { action: true } } } },
      },
    });

    if (!assignee) {
      throw new NotFoundException(`User with ID '${assignedToId}' not found`);
    }
    if (!assignee.isActive) {
      throw new BadRequestException('El usuario asignado no está activo');
    }
    if (
      !assignee.role.permissions.some(
        (p) => p.action === TICKET_UPDATE_PERMISSION,
      )
    ) {
      throw new BadRequestException(
        'El usuario asignado no tiene el permiso tickets:update',
      );
    }
    if (
      assignee.branches.length > 0 &&
      !assignee.branches.some((b) => b.id === branchId)
    ) {
      throw new BadRequestException(
        'El usuario asignado no tiene acceso a la sucursal de este ticket',
      );
    }
  }

  // Deja constancia en TicketNotification antes de emitir por socket, para
  // que un usuario desconectado en ese momento pueda listar el aviso al
  // volver a entrar (ver GET /tickets/notifications) en vez de perderlo.
  private async persistAndNotify(
    userIds: (string | null | undefined)[],
    ticketId: string,
    message: string,
  ) {
    const uniqueIds = [...new Set(userIds.filter((id): id is string => !!id))];

    if (uniqueIds.length > 0) {
      await this.prisma.ticketNotification.createMany({
        data: uniqueIds.map((userId) => ({ userId, ticketId, message })),
      });
    }

    this.ticketsGateway.notifyUsers(userIds, ticketId, message);
  }

  async findMyNotifications(
    dto: FindTicketNotificationsDto,
    user: RequestUser,
  ) {
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
      }),
      this.prisma.ticketNotification.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async markNotificationRead(id: string, user: RequestUser) {
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

  async markAllNotificationsRead(user: RequestUser) {
    const { count } = await this.prisma.ticketNotification.updateMany({
      where: { userId: user.id, read: false },
      data: { read: true },
    });

    return { updated: count };
  }
}
