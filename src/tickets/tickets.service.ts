import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Ticket, TicketPriority, TicketStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { CloudinaryService } from 'src/common/cloudinary/cloudinary.service';
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
import { AttachmentDto } from './dto/attachment.dto';
import { CreateTicketCommentDto } from './dto/create-ticket-comment.dto';
import { CreateTicketDto } from './dto/create-ticket.dto';
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
    attachments: true,
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
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  async create(
    createTicketDto: CreateTicketDto,
    user: BranchScopedUser & { id: string },
  ) {
    assertBranchAccess(user, createTicketDto.branchId);

    try {
      const { attachments, ...ticketData } = createTicketDto;

      const ticket = await this.prisma.ticket.create({
        data: {
          ...ticketData,
          createdById: user.id,
          attachments: attachments?.length
            ? { create: attachments }
            : undefined,
        },
        ...ticketWithRelations,
      });

      this.ticketsGateway.emitNewTicket(ticket);

      return ticket;
    } catch (error) {
      handleDatabaseErrors(error, 'Ticket');
    }
  }

  async findAll(dto: FindTicketsDto, user: BranchScopedUser) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['title', 'description'],
      defaultSort: { createdAt: 'desc' },
      allowedFields: TICKET_ALLOWED_FIELDS,
    });

    const finalWhere = {
      ...where,
      ...userBranchFilter(user, dto.branchId),
      ...(dto.status && { status: dto.status }),
      ...(dto.category && { category: dto.category }),
      ...(dto.priority && { priority: dto.priority }),
      ...(dto.assignedToId && { assignedToId: dto.assignedToId }),
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
    assertBranchAccess(user, ticket.branchId);

    const canSeeInternalComments = user.role.permissions.includes(
      TICKET_UPDATE_PERMISSION,
    );

    return {
      ...ticket,
      comments: canSeeInternalComments
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
    assertBranchAccess(user, ticket.branchId);

    if (
      dto.isInternal &&
      !user.role.permissions.includes(TICKET_UPDATE_PERMISSION)
    ) {
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

      this.ticketsGateway.notifyUsers(
        [ticket.createdById, ticket.assignedToId].filter(
          (id) => id !== user.id,
        ),
        ticketId,
        `${user.name} comentó: ${preview}`,
      );
    }

    return comment;
  }

  async addAttachment(
    ticketId: string,
    dto: AttachmentDto,
    user: BranchScopedUser,
  ) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) {
      throw new NotFoundException(`Ticket with ID '${ticketId}' not found`);
    }
    assertBranchAccess(user, ticket.branchId);

    return this.prisma.ticketAttachment.create({
      data: { ...dto, ticketId },
    });
  }

  // Sin :id porque un ticket nuevo aún no existe cuando el frontend necesita
  // subir sus adjuntos (el flujo es: pedir firma -> subir a Cloudinary ->
  // mandar la URL resultante en POST /tickets o POST /tickets/:id/attachments).
  // A diferencia de los documentos firmados de resguardos, los adjuntos de
  // tickets se suben públicos (type: upload, resource_type: auto) porque son
  // evidencia interna (fotos, capturas) sin necesidad de URL firmada con
  // expiración.
  createUploadSignature() {
    const publicId = `tickets/attachment-${Date.now()}-${randomUUID()}`;
    return this.cloudinaryService.generateSignedUploadParams(publicId, {
      resourceType: 'auto',
      type: 'upload',
    });
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
    this.ticketsGateway.notifyUsers(
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
}
