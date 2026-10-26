import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Category,
  Prisma,
  Ticket,
  TicketForm,
  TicketFormType,
  TicketNotificationKind,
  TicketPriority,
  TicketStatus,
} from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import {
  assertBranchAccess,
  userBranchFilter,
} from 'src/common/utils/branch-access.util';
import {
  buildPaginatedQuery,
  paginatedResponse,
} from 'src/common/utils/paginate.util';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { MailService } from 'src/mail/mail.service';
import { computeDueAt } from './constants/ticket-sla.const';
import {
  addBusinessTime,
  businessTimeBetween,
} from './constants/business-hours';
import { CreateTicketCommentDto } from './dto/create-ticket-comment.dto';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { FindAssignableUsersDto } from './dto/find-assignable-users.dto';
import { FindTicketNotificationsDto } from './dto/find-ticket-notifications.dto';
import { FindTicketsDto, TicketFormStatus } from './dto/find-tickets.dto';
import { SetTicketAssigneesDto } from './dto/set-ticket-assignees.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { TicketsGateway } from './tickets.gateway';
import { TicketFormsService } from './forms/ticket-forms.service';
import {
  PRIVILEGED_PERMISSION_MODULES,
  resolveFormType,
  SUBCATEGORY_FORM_CATEGORIES,
  TICKET_FORM_DEFINITIONS,
} from './forms/ticket-forms.const';
import { TicketFormApplyResult } from './forms/ticket-form-handler.interface';

const TICKET_ALLOWED_FIELDS = [
  'code',
  'title',
  'status',
  'priority',
  'category',
  'createdAt',
];

const TICKET_UPDATE_PERMISSION = 'tickets:update';

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  OPEN: 'Abierto',
  IN_PROGRESS: 'En progreso',
  ON_HOLD: 'En espera',
  RESOLVED: 'Resuelto',
  CLOSED: 'Cerrado',
  CANCELLED: 'Cancelado',
};

const TICKET_STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CANCELLED'],
  IN_PROGRESS: ['ON_HOLD', 'RESOLVED', 'CANCELLED'],
  ON_HOLD: ['IN_PROGRESS', 'CANCELLED'],
  RESOLVED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: ['IN_PROGRESS'],
  CANCELLED: [],
};

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  CRITICAL: 'Crítica',
};

export const CATEGORY_LABELS: Record<Category, string> = {
  HARDWARE: 'Hardware',
  SOFTWARE: 'Software',
  ACCESS: 'Accesos',
  COGNITI: 'CogniTI',
  OTHER: 'Otro',
};

const COMMENT_PREVIEW_LENGTH = 140;

/** Read notifications are deleted after this many days (unread ones stay). */
export const NOTIFICATION_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

const notificationKindOf = (entries: ChangeEntry[]): TicketNotificationKind =>
  entries.some((e) => e.type.startsWith('FORM_'))
    ? 'FORM'
    : entries.some((e) => e.type === 'ASSIGNED' || e.type === 'UNASSIGNED')
      ? 'ASSIGNMENT'
      : 'CHANGE';

const REOPENABLE_STATUSES: TicketStatus[] = ['RESOLVED', 'CLOSED'];

const FORM_LOCKED_STATUSES: TicketStatus[] = ['CLOSED', 'CANCELLED'];

const FORM_STATUS_WHERE: Record<TicketFormStatus, Prisma.TicketWhereInput> = {
  PENDING: {
    form: { appliedAt: null, rejectedAt: null },
    status: { notIn: FORM_LOCKED_STATUSES },
  },
  APPLIED: { form: { appliedAt: { not: null } } },
  REJECTED: { form: { rejectedAt: { not: null } } },
};

/** Thrown inside a dry-run transaction to roll it back with its result. */
class DryRunRollback extends Error {
  constructor(readonly result: TicketFormApplyResult) {
    super('dry run');
  }
}

/**
 * Tickets a user may create per minute. Counted on created tickets, so a form
 * rejected by validation doesn't use up the quota (the throttler on the route
 * only stops floods).
 */
export const TICKET_CREATE_LIMIT = { count: 10, windowMs: 60_000 };

/** Applying a form may create a panel with its children: more than the 5 s default. */
const FORM_APPLY_TIMEOUT_MS = 30_000;

const ticketWithRelations = Prisma.validator<Prisma.TicketDefaultArgs>()({
  include: {
    branch: { select: { id: true, name: true } },
    createdBy: { select: { id: true, name: true, email: true } },
    assignees: {
      orderBy: { assignedAt: 'asc' },
      select: {
        assignedAt: true,
        user: { select: { id: true, name: true, email: true } },
        assignedBy: { select: { id: true, name: true } },
      },
    },
    subcategory: {
      select: { id: true, category: true, name: true, formType: true },
    },
    form: {
      select: {
        type: true,
        schemaVersion: true,
        data: true,
        result: true,
        appliedAt: true,
        appliedBy: { select: { id: true, name: true } },
        rejectedAt: true,
        rejectedBy: { select: { id: true, name: true } },
        rejectionReason: true,
        updatedAt: true,
      },
    },
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

interface TraceabilityFields {
  resolvedAt?: Date | null;
  closedAt?: Date | null;
  reopenedCount?: number;
  dueAt?: Date | null;
  overdueNotifiedAt?: Date | null;
  firstResponseAt?: Date;
  onHoldSince?: Date | null;
  slaPausedSeconds?: number;
}

interface ChangeEntry {
  type: Prisma.TicketEventCreateManyInput['type'];
  fromValue: string | null;
  toValue: string | null;
  text: string;
}

const assigneeIdsOf = (ticket: { assignees: { user: { id: string } }[] }) =>
  ticket.assignees.map((a) => a.user.id);

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketsGateway: TicketsGateway,
    private readonly mailService: MailService,
    private readonly ticketForms: TicketFormsService,
  ) {}

  async create(createTicketDto: CreateTicketDto, user: RequestUser) {
    const { form, ...ticketData } = createTicketDto;
    assertBranchAccess(user, ticketData.branchId);
    await this.assertCreateQuota(user.id);

    const formType = await this.resolveTicketFormType(
      ticketData.category,
      ticketData.subcategoryId,
    );

    if (formType && form === undefined) {
      throw new BadRequestException(
        `form es requerido: la categoría lleva el formulario "${TICKET_FORM_DEFINITIONS[formType].label}"`,
      );
    }
    if (!formType && form !== undefined) {
      throw new BadRequestException(
        'La categoría seleccionada no lleva formulario (form)',
      );
    }

    const parsedForm = formType
      ? await this.ticketForms.parse(formType, form, {
          branchId: ticketData.branchId,
          actor: user,
          phase: 'request',
        })
      : null;

    // Forms that generate the title (access, CogniTI) don't ask for title or description.
    const title = ticketData.title ?? parsedForm?.title;
    if (!title) {
      throw new BadRequestException(['title es requerido']);
    }
    if (!parsedForm?.title && !ticketData.description) {
      throw new BadRequestException(['description es requerido']);
    }

    const now = new Date();
    const priority = ticketData.priority ?? TicketPriority.MEDIUM;

    try {
      const ticket = await this.prisma.$transaction(async (tx) => {
        // Folio per branch: the counter row is locked by the increment, so
        // concurrent tickets of the same branch get consecutive codes.
        const { lastCode: code } = await tx.ticketCounter.upsert({
          where: { branchId: ticketData.branchId },
          create: { branchId: ticketData.branchId, lastCode: 1 },
          update: { lastCode: { increment: 1 } },
        });
        return tx.ticket.create({
          data: {
            ...ticketData,
            code,
            title,
            createdById: user.id,
            dueAt: computeDueAt(priority, now),
            ...(formType &&
              parsedForm && {
                form: {
                  create: {
                    type: formType,
                    schemaVersion: TICKET_FORM_DEFINITIONS[formType].version,
                    data: parsedForm.data,
                  },
                },
              }),
          },
          ...ticketWithRelations,
        });
      });

      await this.prisma.ticketEvent.create({
        data: { type: 'CREATED', ticketId: ticket.id, actorId: user.id },
      });

      this.ticketsGateway.emitNewTicket(ticket);
      await this.notifyNewTicket(ticket, user);

      return ticket;
    } catch (error) {
      handleDatabaseErrors(error, 'Ticket');
    }
  }

  /**
   * Notifies the TI staff that can see the ticket (tickets:update, global or
   * of its branch). The ticket already exists: a failure is only logged.
   */
  private async notifyNewTicket(
    ticket: TicketWithRelations,
    user: RequestUser,
  ) {
    try {
      const staff = await this.prisma.user.findMany({
        where: {
          isActive: true,
          id: { not: user.id },
          role: {
            permissions: { some: { action: TICKET_UPDATE_PERMISSION } },
          },
          OR: [
            { branches: { none: {} } },
            { branches: { some: { id: ticket.branchId } } },
          ],
        },
        select: { id: true, email: true },
      });
      if (staff.length === 0) return;

      await this.persistAndNotify(
        staff.map((member) => member.id),
        ticket,
        {
          kind: 'NEW_TICKET',
          message: `${user.name} levantó el ticket #${ticket.code} "${ticket.title}" en ${ticket.branch.name}.`,
          actorId: user.id,
        },
      );

      for (const member of staff) {
        this.mailService
          .sendNewTicketEmail(member.email, {
            ticketId: ticket.id,
            code: ticket.code,
            title: ticket.title,
            categoryLabel: CATEGORY_LABELS[ticket.category],
            priorityLabel: TICKET_PRIORITY_LABELS[ticket.priority],
            branchName: ticket.branch.name,
            createdByName: user.name,
          })
          .catch((error: unknown) => {
            this.logger.error(
              `No se pudo enviar el correo del ticket nuevo #${ticket.code} a ${member.email}: ${(error as Error).message}`,
            );
          });
      }
    } catch (error) {
      this.logger.error(
        `No se pudo notificar el ticket nuevo #${ticket.code}: ${(error as Error).message}`,
      );
    }
  }

  private async assertCreateQuota(userId: string) {
    const recent = await this.prisma.ticket.count({
      where: {
        createdById: userId,
        createdAt: { gte: new Date(Date.now() - TICKET_CREATE_LIMIT.windowMs) },
      },
    });
    if (recent >= TICKET_CREATE_LIMIT.count) {
      throw new HttpException(
        `Creaste ${recent} tickets en el último minuto: espera un momento antes de crear otro`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private hasTicketUpdatePermission(user: RequestUser): boolean {
    return user.role.permissions.includes(TICKET_UPDATE_PERMISSION);
  }

  private assertTicketAccess(
    ticket: { branchId: string; createdById: string },
    assigneeIds: string[],
    user: RequestUser,
  ): boolean {
    const canSeeAllTickets = this.hasTicketUpdatePermission(user);

    if (canSeeAllTickets) {
      assertBranchAccess(user, ticket.branchId);
    } else if (
      ticket.createdById !== user.id &&
      !assigneeIds.includes(user.id)
    ) {
      throw new ForbiddenException('No tienes acceso a este ticket');
    }

    return canSeeAllTickets;
  }

  /**
   * Tickets the user created or is assigned to. With branchId, both are limited
   * to that branch, except assignments in branches the user has no access to:
   * those have no branch of their own to show up in, so they always appear.
   */
  private ownTicketsFilter(
    user: RequestUser,
    branchId?: string,
  ): Prisma.TicketWhereInput {
    const isAssignee = { assignees: { some: { userId: user.id } } };
    if (!branchId) {
      return { OR: [{ createdById: user.id }, isAssignee] };
    }

    const userBranchIds = user.branches?.map((b) => b.id) ?? [];
    return {
      OR: [
        { createdById: user.id, branchId },
        { ...isAssignee, branchId },
        ...(userBranchIds.length > 0
          ? [{ ...isAssignee, branchId: { notIn: userBranchIds } }]
          : []),
      ],
    };
  }

  async findAll(dto: FindTicketsDto, user: RequestUser) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['title', 'description'],
      defaultSort: { createdAt: 'desc' },
      allowedFields: TICKET_ALLOWED_FIELDS,
    });

    const onlyMine = dto.mine || !this.hasTicketUpdatePermission(user);

    const conditions: Prisma.TicketWhereInput[] = [
      where as Prisma.TicketWhereInput,
      {
        ...(!onlyMine && userBranchFilter(user, dto.branchId)),
        ...(dto.status && { status: dto.status }),
        ...(dto.category && { category: dto.category }),
        ...(dto.priority && { priority: dto.priority }),
        ...(dto.subcategoryId && { subcategoryId: dto.subcategoryId }),
      },
    ];
    if (dto.assigneeId) {
      conditions.push({ assignees: { some: { userId: dto.assigneeId } } });
    }
    if (dto.formType) {
      conditions.push({ form: { type: dto.formType } });
    }
    if (dto.formStatus) {
      conditions.push(FORM_STATUS_WHERE[dto.formStatus]);
    }
    if (dto.assignedToMe) {
      conditions.push({ assignees: { some: { userId: user.id } } });
    }
    if (onlyMine) {
      conditions.push(this.ownTicketsFilter(user, dto.branchId));
    }

    const finalWhere: Prisma.TicketWhereInput = { AND: conditions };

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

    const canSeeAllTickets = this.assertTicketAccess(
      ticket,
      assigneeIdsOf(ticket),
      user,
    );

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
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: { form: { select: { type: true } } },
    });
    if (!ticket) {
      throw new NotFoundException(`Ticket with ID '${id}' not found`);
    }
    assertBranchAccess(user, ticket.branchId);

    if (updateTicketDto.status && updateTicketDto.status !== ticket.status) {
      this.assertValidStatusTransition(ticket.status, updateTicketDto.status);
    }

    if (updateTicketDto.subcategoryId) {
      await this.assertSubcategoryBelongsToCategory(
        updateTicketDto.subcategoryId,
        updateTicketDto.category ?? ticket.category,
      );
    }
    await this.assertFormKeptOnReclassify(ticket, updateTicketDto);

    const traceabilityData = this.computeTraceabilityFields(
      ticket,
      updateTicketDto,
    );

    try {
      const updated = await this.prisma.ticket.update({
        where: { id },
        data: {
          ...(updateTicketDto.status && { status: updateTicketDto.status }),
          ...(updateTicketDto.priority && {
            priority: updateTicketDto.priority,
          }),
          ...(updateTicketDto.category && {
            category: updateTicketDto.category,
          }),
          ...(updateTicketDto.subcategoryId !== undefined && {
            subcategoryId: updateTicketDto.subcategoryId,
          }),
          ...traceabilityData,
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
      include: { assignees: { select: { userId: true } } },
    });
    if (!ticket) {
      throw new NotFoundException(`Ticket with ID '${ticketId}' not found`);
    }

    const assigneeIds = ticket.assignees.map((a) => a.userId);
    const canSeeAllTickets = this.assertTicketAccess(ticket, assigneeIds, user);

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

      await this.persistAndNotify(
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

  private computeTraceabilityFields(
    ticket: Ticket,
    dto: UpdateTicketDto,
  ): TraceabilityFields {
    const data: TraceabilityFields = {};
    const now = new Date();
    let pausedSeconds = ticket.slaPausedSeconds ?? 0;
    let dueAt = ticket.dueAt;

    // The SLA does not run while waiting (ON_HOLD): the business time spent
    // on hold moves dueAt.
    if (dto.status && dto.status !== ticket.status) {
      if (dto.status === 'ON_HOLD') {
        data.onHoldSince = now;
      } else if (ticket.status === 'ON_HOLD' && ticket.onHoldSince) {
        const pausedMs = businessTimeBetween(ticket.onHoldSince, now);
        pausedSeconds += Math.round(pausedMs / 1000);
        data.slaPausedSeconds = pausedSeconds;
        data.onHoldSince = null;
        if (dueAt) {
          dueAt = addBusinessTime(dueAt, pausedMs);
          data.dueAt = dueAt;
          if (dueAt > now) data.overdueNotifiedAt = null;
        }
      }
    }

    if (dto.status && dto.status !== ticket.status) {
      if (dto.status === 'RESOLVED') {
        data.resolvedAt = new Date();
      }
      if (dto.status === 'CLOSED') {
        data.closedAt = new Date();
        if (!ticket.resolvedAt) data.resolvedAt = new Date();
      }
      if (
        dto.status === 'IN_PROGRESS' &&
        REOPENABLE_STATUSES.includes(ticket.status)
      ) {
        data.resolvedAt = null;
        data.closedAt = null;
        data.reopenedCount = ticket.reopenedCount + 1;
        data.overdueNotifiedAt = null;
      }
    }

    if (dto.priority && dto.priority !== ticket.priority) {
      data.dueAt = computeDueAt(
        dto.priority,
        ticket.createdAt,
        pausedSeconds * 1000,
      );
      data.overdueNotifiedAt = null;
    }

    return data;
  }

  private buildChangeEntries(
    previousTicket: Pick<
      Ticket,
      'status' | 'priority' | 'category' | 'subcategoryId'
    >,
    updatedTicket: TicketWithRelations,
    dto: UpdateTicketDto,
    previousSubcategoryName: string | null,
  ): ChangeEntry[] {
    const entries: ChangeEntry[] = [];

    if (dto.status && dto.status !== previousTicket.status) {
      entries.push({
        type: 'STATUS_CHANGED',
        fromValue: previousTicket.status,
        toValue: updatedTicket.status,
        text: `cambió el estado de "${TICKET_STATUS_LABELS[previousTicket.status]}" a "${TICKET_STATUS_LABELS[updatedTicket.status]}"`,
      });

      if (
        updatedTicket.status === 'IN_PROGRESS' &&
        REOPENABLE_STATUSES.includes(previousTicket.status)
      ) {
        entries.push({
          type: 'REOPENED',
          fromValue: previousTicket.status,
          toValue: updatedTicket.status,
          text: 'reabrió el ticket',
        });
      }
    }

    if (dto.priority && dto.priority !== previousTicket.priority) {
      entries.push({
        type: 'PRIORITY_CHANGED',
        fromValue: previousTicket.priority,
        toValue: updatedTicket.priority,
        text: `cambió la prioridad de "${TICKET_PRIORITY_LABELS[previousTicket.priority]}" a "${TICKET_PRIORITY_LABELS[updatedTicket.priority]}"`,
      });
    }

    if (dto.category && dto.category !== previousTicket.category) {
      entries.push({
        type: 'CATEGORY_CHANGED',
        fromValue: previousTicket.category,
        toValue: updatedTicket.category,
        text: `cambió la categoría de "${CATEGORY_LABELS[previousTicket.category]}" a "${CATEGORY_LABELS[updatedTicket.category]}"`,
      });
    }

    if (
      dto.subcategoryId !== undefined &&
      dto.subcategoryId !== previousTicket.subcategoryId
    ) {
      const fromLabel = previousSubcategoryName ?? 'sin subcategoría';
      const toLabel = updatedTicket.subcategory?.name ?? 'sin subcategoría';
      entries.push({
        type: 'SUBCATEGORY_CHANGED',
        fromValue: previousTicket.subcategoryId,
        toValue: updatedTicket.subcategoryId,
        text: `cambió la subcategoría de "${fromLabel}" a "${toLabel}"`,
      });
    }

    return entries;
  }

  private async recordChangeAndNotify(
    previousTicket: Pick<
      Ticket,
      | 'id'
      | 'branchId'
      | 'code'
      | 'title'
      | 'status'
      | 'priority'
      | 'category'
      | 'subcategoryId'
      | 'createdById'
    >,
    updatedTicket: TicketWithRelations,
    dto: UpdateTicketDto,
    user: RequestUser,
  ) {
    const previousSubcategoryName =
      dto.subcategoryId !== undefined &&
      dto.subcategoryId !== previousTicket.subcategoryId &&
      previousTicket.subcategoryId
        ? ((
            await this.prisma.ticketSubcategory.findUnique({
              where: { id: previousTicket.subcategoryId },
              select: { name: true },
            })
          )?.name ?? null)
        : null;

    const entries = this.buildChangeEntries(
      previousTicket,
      updatedTicket,
      dto,
      previousSubcategoryName,
    );

    await this.recordEntriesAndNotify(
      previousTicket,
      entries,
      [previousTicket.createdById, ...assigneeIdsOf(updatedTicket)],
      user,
    );
  }

  private async recordEntriesAndNotify(
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
    await this.persistAndNotify(
      recipientIds.filter((id) => id !== user.id),
      ticket,
      { kind: notificationKindOf(entries), message, actorId: user.id },
    );
  }

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

    await this.recordEntriesAndNotify(
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

  private assertValidStatusTransition(from: TicketStatus, to: TicketStatus) {
    if (!TICKET_STATUS_TRANSITIONS[from].includes(to)) {
      throw new BadRequestException(
        `No se puede cambiar el estado de "${TICKET_STATUS_LABELS[from]}" a "${TICKET_STATUS_LABELS[to]}"`,
      );
    }
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

  private async assertSubcategoryBelongsToCategory(
    subcategoryId: string,
    category: Category,
  ) {
    const subcategory = await this.prisma.ticketSubcategory.findUnique({
      where: { id: subcategoryId },
      select: { category: true, formType: true },
    });

    if (!subcategory) {
      throw new NotFoundException(
        `TicketSubcategory with ID '${subcategoryId}' not found`,
      );
    }
    if (subcategory.category !== category) {
      throw new BadRequestException(
        `La subcategoría no pertenece a la categoría '${category}'`,
      );
    }

    return subcategory;
  }

  /** Validates the subcategory and returns the form the ticket must carry. */
  private async resolveTicketFormType(
    category: Category,
    subcategoryId: string | null | undefined,
  ): Promise<TicketFormType | null> {
    if (!subcategoryId && SUBCATEGORY_FORM_CATEGORIES.includes(category)) {
      throw new BadRequestException(
        `subcategoryId es requerido para la categoría ${CATEGORY_LABELS[category]}`,
      );
    }
    const subcategory = subcategoryId
      ? await this.assertSubcategoryBelongsToCategory(subcategoryId, category)
      : null;
    return resolveFormType(category, subcategory?.formType);
  }

  /** A ticket keeps its form: it can only move where the same form applies. */
  private async assertFormKeptOnReclassify(
    ticket: Pick<Ticket, 'category' | 'subcategoryId'> & {
      form: { type: TicketFormType } | null;
    },
    dto: UpdateTicketDto,
  ) {
    const category = dto.category ?? ticket.category;
    const subcategoryId =
      dto.subcategoryId !== undefined
        ? dto.subcategoryId
        : ticket.subcategoryId;
    if (
      category === ticket.category &&
      subcategoryId === ticket.subcategoryId
    ) {
      return;
    }

    const currentFormType = ticket.form?.type ?? null;
    const newFormType = await this.resolveTicketFormType(
      category,
      subcategoryId,
    );
    if (newFormType !== currentFormType) {
      throw new BadRequestException(
        currentFormType
          ? `El ticket tiene un formulario de "${TICKET_FORM_DEFINITIONS[currentFormType].label}": solo puede reclasificarse donde aplique ese mismo formulario`
          : 'La nueva clasificación requiere un formulario: crea un ticket nuevo en esa categoría',
      );
    }
  }

  async updateForm(id: string, payload: unknown, user: RequestUser) {
    const ticket = await this.findTicketWithForm(id);

    if (this.hasTicketUpdatePermission(user)) {
      assertBranchAccess(user, ticket.branchId);
    } else if (ticket.createdById !== user.id) {
      throw new ForbiddenException(
        'Solo quien reportó el ticket o TI pueden editar el formulario',
      );
    }

    const form = this.assertFormIsPending(ticket);
    const { data, title } = await this.ticketForms.parse(form.type, payload, {
      branchId: ticket.branchId,
      actor: user,
      phase: 'request',
    });

    await this.prisma.$transaction(async (tx) => {
      // Only while pending: an approval may have committed since the read above.
      const { count } = await tx.ticketForm.updateMany({
        where: { ticketId: id, appliedAt: null, rejectedAt: null },
        // Saved by the current DTOs: it's now data of the current version.
        data: {
          data,
          schemaVersion: TICKET_FORM_DEFINITIONS[form.type].version,
        },
      });
      if (count === 0) {
        throw new ConflictException(
          'El formulario ya fue aprobado o rechazado',
        );
      }
      // Forms that generate the title keep it in sync with their data.
      if (title && title !== ticket.title) {
        await tx.ticket.update({ where: { id }, data: { title } });
      }
    });

    return this.recordFormChange(
      ticket,
      [
        {
          type: 'FORM_UPDATED',
          fromValue: null,
          toValue: form.type,
          text: 'actualizó los datos del formulario',
        },
      ],
      user,
    );
  }

  /** Checks shared by approving and validating a form. */
  private async findApplicableForm(id: string, user: RequestUser) {
    const ticket = await this.findTicketWithForm(id);
    assertBranchAccess(user, ticket.branchId);
    const form = this.assertFormIsPending(ticket);

    const { applyPermission } = TICKET_FORM_DEFINITIONS[form.type];
    if (!applyPermission || !this.ticketForms.isApplicable(form.type)) {
      throw new BadRequestException(
        'Este formulario es informativo: no tiene una acción que aprobar',
      );
    }
    if (!user.role.permissions.includes(applyPermission)) {
      throw new ForbiddenException(
        `Aprobar este formulario requiere el permiso ${applyPermission}`,
      );
    }
    return { ticket, form };
  }

  /**
   * Runs the requested action inside a transaction. `dryRun` rolls everything
   * back at the end: same checks and errors as approving, nothing saved.
   */
  private async runFormAction(
    ticket: Ticket,
    form: TicketForm,
    payload: unknown,
    user: RequestUser,
    { dryRun }: { dryRun: boolean },
  ) {
    const resolves = ticket.status !== 'RESOLVED';
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const { count } = await tx.ticketForm.updateMany({
            where: { ticketId: ticket.id, appliedAt: null, rejectedAt: null },
            data: { appliedAt: new Date(), appliedById: user.id },
          });
          if (count === 0) {
            throw new ConflictException(
              'El formulario ya fue aprobado o rechazado',
            );
          }

          // Read after the claim: an edit saved meanwhile is what gets applied.
          const claimed = await tx.ticketForm.findUniqueOrThrow({
            where: { ticketId: ticket.id },
            select: { data: true, schemaVersion: true },
          });
          const result = await this.ticketForms.apply(
            form.type,
            this.ticketForms.upgrade(
              form.type,
              claimed.schemaVersion,
              claimed.data,
            ),
            payload,
            { branchId: ticket.branchId, actor: user, phase: 'apply' },
            tx,
          );

          if (dryRun) throw new DryRunRollback(result);

          await tx.ticketForm.update({
            where: { ticketId: ticket.id },
            data: { result: result.result },
          });
          if (resolves) {
            await tx.ticket.update({
              where: { id: ticket.id },
              data: {
                status: 'RESOLVED',
                ...this.computeTraceabilityFields(ticket, {
                  status: 'RESOLVED',
                }),
              },
            });
          }
          return { ...result, resolves };
        },
        { timeout: FORM_APPLY_TIMEOUT_MS },
      );
    } catch (error) {
      if (error instanceof DryRunRollback) {
        return { ...error.result, resolves };
      }
      throw error;
    }
  }

  /**
   * IT approves the request: the action (create study, user…) and the ticket
   * changes commit together, so a failure leaves the form pending.
   */
  async applyForm(id: string, payload: unknown, user: RequestUser) {
    const { ticket, form } = await this.findApplicableForm(id, user);
    const applied = await this.runFormAction(ticket, form, payload, user, {
      dryRun: false,
    });

    // Side effects (e.g. the access email) must not delay or fail the approval.
    if (applied.afterCommit) {
      void this.runAfterCommit(id, applied.afterCommit);
    }

    const entries: ChangeEntry[] = [
      {
        type: 'FORM_APPLIED',
        fromValue: null,
        toValue: form.type,
        text: `aprobó la solicitud y ${applied.summary}`,
      },
    ];
    if (applied.resolves) {
      entries.push({
        type: 'STATUS_CHANGED',
        fromValue: ticket.status,
        toValue: 'RESOLVED',
        text: `cambió el estado de "${TICKET_STATUS_LABELS[ticket.status]}" a "${TICKET_STATUS_LABELS.RESOLVED}"`,
      });
    }

    return this.recordFormChange(ticket, entries, user);
  }

  /**
   * Same as approving (same body, checks and errors) but rolled back: tells IT
   * whether the approval would work and what it would do.
   */
  async validateForm(id: string, payload: unknown, user: RequestUser) {
    const { ticket, form } = await this.findApplicableForm(id, user);
    const preview = await this.runFormAction(ticket, form, payload, user, {
      dryRun: true,
    });
    return { valid: true, summary: preview.summary };
  }

  /** IT turns the request down: the form is closed and the ticket cancelled. */
  async rejectForm(id: string, reason: string, user: RequestUser) {
    const ticket = await this.findTicketWithForm(id);
    assertBranchAccess(user, ticket.branchId);
    const form = this.assertFormIsPending(ticket);

    const cancels = ticket.status !== 'CANCELLED';
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.ticketForm.updateMany({
        where: { ticketId: id, appliedAt: null, rejectedAt: null },
        data: {
          rejectedAt: new Date(),
          rejectedById: user.id,
          rejectionReason: reason,
        },
      });
      if (count === 0) {
        throw new ConflictException(
          'El formulario ya fue aprobado o rechazado',
        );
      }
      if (cancels) {
        await tx.ticket.update({
          where: { id },
          data: {
            status: 'CANCELLED',
            ...this.computeTraceabilityFields(ticket, { status: 'CANCELLED' }),
          },
        });
      }
    });

    const entries: ChangeEntry[] = [
      {
        type: 'FORM_REJECTED',
        fromValue: null,
        toValue: form.type,
        text: `rechazó la solicitud: ${reason}`,
      },
    ];
    if (cancels) {
      entries.push({
        type: 'STATUS_CHANGED',
        fromValue: ticket.status,
        toValue: 'CANCELLED',
        text: `cambió el estado de "${TICKET_STATUS_LABELS[ticket.status]}" a "${TICKET_STATUS_LABELS.CANCELLED}"`,
      });
    }
    return this.recordFormChange(ticket, entries, user);
  }

  /** Sends again the "your access is ready" email of an approved request. */
  async resendAccessEmail(id: string, user: RequestUser) {
    const ticket = await this.findTicketWithForm(id);
    assertBranchAccess(user, ticket.branchId);
    if (ticket.form?.type !== 'ACCESS_REQUEST' || !ticket.form.appliedAt) {
      throw new BadRequestException(
        'Solo se reenvía el correo de una solicitud de acceso aprobada',
      );
    }
    if (!user.role.permissions.includes('users:create')) {
      throw new ForbiddenException(
        'Reenviar el correo de acceso requiere el permiso users:create',
      );
    }

    const { fullName, email } = ticket.form.data as {
      fullName: string;
      email: string;
    };
    let emailSent = true;
    try {
      await this.mailService.sendAccessGrantedEmail(email, fullName);
    } catch (error) {
      emailSent = false;
      this.logger.error(
        `No se pudo reenviar el correo de acceso a ${email}`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    await this.prisma.ticketForm.update({
      where: { ticketId: id },
      data: {
        result: {
          ...((ticket.form.result ?? {}) as Prisma.JsonObject),
          emailSent,
        },
      },
    });
    if (!emailSent) {
      throw new ServiceUnavailableException(
        `No se pudo enviar el correo a ${email}: inténtalo más tarde`,
      );
    }
    return this.findTicketSummary(id);
  }

  /**
   * Roles a requester may ask for in an access ticket: none that manages users,
   * roles or permissions (those are granted by an administrator directly).
   */
  findFormRoles() {
    return this.prisma.role.findMany({
      where: {
        permissions: {
          none: {
            OR: PRIVILEGED_PERMISSION_MODULES.map((module) => ({
              action: { startsWith: `${module}:` },
            })),
          },
        },
      },
      select: { id: true, name: true, description: true },
      orderBy: { name: 'asc' },
    });
  }

  private findTicketSummary(id: string) {
    return this.prisma.ticket.findUniqueOrThrow({
      where: { id },
      ...ticketWithRelations,
    });
  }

  private async findTicketWithForm(id: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        form: true,
        assignees: { select: { userId: true } },
      },
    });
    if (!ticket) {
      throw new NotFoundException(`Ticket with ID '${id}' not found`);
    }
    return ticket;
  }

  private assertFormIsPending(
    ticket: Pick<Ticket, 'status'> & { form: TicketForm | null },
  ): TicketForm {
    if (!ticket.form) {
      throw new BadRequestException('Este ticket no tiene formulario');
    }
    if (ticket.form.appliedAt) {
      throw new ConflictException('El formulario ya fue aprobado');
    }
    if (ticket.form.rejectedAt) {
      throw new ConflictException('El formulario fue rechazado');
    }
    if (FORM_LOCKED_STATUSES.includes(ticket.status)) {
      throw new BadRequestException(
        `No se puede modificar el formulario de un ticket ${TICKET_STATUS_LABELS[ticket.status].toLowerCase()}`,
      );
    }
    return ticket.form;
  }

  /** Merges what the side effect reports (e.g. emailSent) into form.result. */
  private async runAfterCommit(
    ticketId: string,
    afterCommit: NonNullable<TicketFormApplyResult['afterCommit']>,
  ) {
    try {
      const patch = await afterCommit();
      if (!patch) return;
      const form = await this.prisma.ticketForm.findUniqueOrThrow({
        where: { ticketId },
        select: { result: true },
      });
      await this.prisma.ticketForm.update({
        where: { ticketId },
        data: {
          result: {
            ...((form.result ?? {}) as Prisma.JsonObject),
            ...patch,
          },
        },
      });
    } catch (error) {
      this.logger.error(
        `Falló el paso posterior a aprobar el formulario del ticket ${ticketId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async recordFormChange(
    ticket: Pick<
      Ticket,
      'id' | 'branchId' | 'code' | 'title' | 'createdById'
    > & {
      assignees: { userId: string }[];
    },
    entries: ChangeEntry[],
    user: RequestUser,
  ) {
    // The change already committed: a failed comment or notification is logged,
    // never reported as if the change had failed.
    try {
      await this.recordEntriesAndNotify(
        ticket,
        entries,
        [ticket.createdById, ...ticket.assignees.map((a) => a.userId)],
        user,
      );
    } catch (error) {
      this.logger.error(
        `No se pudo registrar el historial del ticket ${ticket.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    const updated = await this.prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      ...ticketWithRelations,
    });
    this.ticketsGateway.emitTicketUpdated(updated);

    return updated;
  }

  private async persistAndNotify(
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

  async removeNotification(id: string, user: RequestUser) {
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
  async purgeMyNotifications(user: RequestUser, all = false) {
    const { count } = await this.prisma.ticketNotification.deleteMany({
      where: { userId: user.id, ...(!all && { read: true }) },
    });
    return { deleted: count };
  }

  /** Housekeeping (cron): read notifications older than the retention window. */
  async purgeOldNotifications(now = new Date()) {
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

      await this.persistAndNotify([ticket.createdById], ticket, {
        kind: 'OVERDUE',
        message,
      });
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
