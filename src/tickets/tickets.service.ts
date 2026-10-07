import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Category,
  Prisma,
  Ticket,
  TicketForm,
  TicketFormType,
  TicketPriority,
  TicketStatus,
} from '@prisma/client';
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
import { MailService } from 'src/mail/mail.service';
import { computeDueAt } from './constants/ticket-sla.const';
import { CreateTicketCommentDto } from './dto/create-ticket-comment.dto';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { FindAssignableUsersDto } from './dto/find-assignable-users.dto';
import { FindTicketNotificationsDto } from './dto/find-ticket-notifications.dto';
import { FindTicketsDto } from './dto/find-tickets.dto';
import { SetTicketAssigneesDto } from './dto/set-ticket-assignees.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { TicketsGateway } from './tickets.gateway';
import { TICKET_FORM_DEFINITIONS } from './forms/ticket-forms.const';
import { TicketFormApplyResult } from './forms/ticket-form-handler.interface';
import { TicketFormsService } from './forms/ticket-forms.service';

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
  NETWORK: 'Red',
  ACCESS: 'Accesos',
  COGNITI: 'CogniTI',
  OTHER: 'Otro',
};

const COMMENT_PREVIEW_LENGTH = 140;

const REOPENABLE_STATUSES: TicketStatus[] = ['RESOLVED', 'CLOSED'];

const FORM_LOCKED_STATUSES: TicketStatus[] = ['CLOSED', 'CANCELLED'];

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
        data: true,
        result: true,
        appliedAt: true,
        appliedBy: { select: { id: true, name: true } },
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

  async create(
    createTicketDto: CreateTicketDto,
    user: BranchScopedUser & { id: string },
  ) {
    const { form, ...ticketData } = createTicketDto;
    assertBranchAccess(user, ticketData.branchId);

    const formType = ticketData.subcategoryId
      ? (
          await this.assertSubcategoryBelongsToCategory(
            ticketData.subcategoryId,
            ticketData.category,
          )
        ).formType
      : null;

    if (formType && !form) {
      throw new BadRequestException(
        `La subcategoría requiere el formulario "${TICKET_FORM_DEFINITIONS[formType].label}" (form)`,
      );
    }
    if (!formType && form) {
      throw new BadRequestException(
        'La subcategoría seleccionada no lleva formulario (form)',
      );
    }

    const formData = formType
      ? await this.ticketForms.parseData(
          formType,
          form,
          { branchId: ticketData.branchId },
          'form',
        )
      : null;

    const now = new Date();
    const priority = ticketData.priority ?? TicketPriority.MEDIUM;

    try {
      const ticket = await this.prisma.ticket.create({
        data: {
          ...ticketData,
          createdById: user.id,
          dueAt: computeDueAt(priority, now),
          ...(formType &&
            formData && {
              form: { create: { type: formType, data: formData } },
            }),
        },
        ...ticketWithRelations,
      });

      await this.prisma.ticketEvent.create({
        data: { type: 'CREATED', ticketId: ticket.id, actorId: user.id },
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

  async findAll(dto: FindTicketsDto, user: RequestUser) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['title', 'description'],
      defaultSort: { createdAt: 'desc' },
      allowedFields: TICKET_ALLOWED_FIELDS,
    });

    const canSeeAllTickets = this.hasTicketUpdatePermission(user);

    const conditions: Prisma.TicketWhereInput[] = [
      where as Prisma.TicketWhereInput,
      {
        ...(canSeeAllTickets
          ? userBranchFilter(user, dto.branchId)
          : dto.branchId && { branchId: dto.branchId }),
        ...(dto.status && { status: dto.status }),
        ...(dto.category && { category: dto.category }),
        ...(dto.priority && { priority: dto.priority }),
        ...(dto.subcategoryId && { subcategoryId: dto.subcategoryId }),
      },
    ];
    if (dto.assigneeId) {
      conditions.push({ assignees: { some: { userId: dto.assigneeId } } });
    }
    if (dto.assignedToMe) {
      conditions.push({ assignees: { some: { userId: user.id } } });
    }
    if (!canSeeAllTickets) {
      conditions.push({
        OR: [
          { createdById: user.id },
          { assignees: { some: { userId: user.id } } },
        ],
      });
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

    const newSubcategory = updateTicketDto.subcategoryId
      ? await this.assertSubcategoryBelongsToCategory(
          updateTicketDto.subcategoryId,
          updateTicketDto.category ?? ticket.category,
        )
      : null;

    if (ticket.form) {
      this.assertFormKeptOnReclassify(
        ticket.form.type,
        ticket,
        updateTicketDto,
        newSubcategory?.formType ?? null,
      );
    }

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

    this.ticketsGateway.emitNewComment(ticketId, comment, [
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
        ticketId,
        `${user.name} comentó: ${preview}`,
      );
    }

    return comment;
  }

  private computeTraceabilityFields(
    ticket: Ticket,
    dto: UpdateTicketDto,
  ): TraceabilityFields {
    const data: TraceabilityFields = {};

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
      data.dueAt = computeDueAt(dto.priority, ticket.createdAt);
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
      previousTicket.id,
      entries,
      [previousTicket.createdById, ...assigneeIdsOf(updatedTicket)],
      user,
    );
  }

  private async recordEntriesAndNotify(
    ticketId: string,
    entries: ChangeEntry[],
    recipientIds: string[],
    user: RequestUser,
  ) {
    if (entries.length === 0) return;

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

    this.ticketsGateway.emitNewComment(ticketId, comment, recipientIds);
    await this.persistAndNotify(recipientIds, ticketId, message);
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
      id,
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

  private assertFormKeptOnReclassify(
    formType: TicketFormType,
    ticket: Pick<Ticket, 'category' | 'subcategoryId'>,
    dto: UpdateTicketDto,
    newSubcategoryFormType: TicketFormType | null,
  ) {
    const changesCategory =
      dto.category !== undefined && dto.category !== ticket.category;
    const changesSubcategory =
      dto.subcategoryId !== undefined &&
      dto.subcategoryId !== ticket.subcategoryId;

    if (
      changesCategory ||
      (changesSubcategory && newSubcategoryFormType !== formType)
    ) {
      throw new BadRequestException(
        `El ticket tiene un formulario de "${TICKET_FORM_DEFINITIONS[formType].label}": solo puede moverse a otra subcategoría con ese mismo formulario`,
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
    const data = await this.ticketForms.parseData(form.type, payload, {
      branchId: ticket.branchId,
    });

    await this.prisma.ticketForm.update({
      where: { ticketId: id },
      data: { data },
    });

    return this.recordFormChange(
      ticket,
      {
        type: 'FORM_UPDATED',
        fromValue: null,
        toValue: form.type,
        text: 'actualizó los datos del formulario',
      },
      user,
    );
  }

  async applyForm(id: string, payload: unknown, user: RequestUser) {
    const ticket = await this.findTicketWithForm(id);
    assertBranchAccess(user, ticket.branchId);
    const form = this.assertFormIsPending(ticket);

    const { count } = await this.prisma.ticketForm.updateMany({
      where: { ticketId: id, appliedAt: null },
      data: { appliedAt: new Date(), appliedById: user.id },
    });
    if (count === 0) {
      throw new ConflictException('El formulario ya fue aprobado');
    }

    let applied: TicketFormApplyResult;
    try {
      applied = await this.ticketForms.apply(form.type, form.data, payload, {
        branchId: ticket.branchId,
      });
    } catch (error) {
      await this.prisma.ticketForm.update({
        where: { ticketId: id },
        data: { appliedAt: null, appliedById: null },
      });
      throw error;
    }

    await this.prisma.ticketForm.update({
      where: { ticketId: id },
      data: { result: applied.result },
    });

    return this.recordFormChange(
      ticket,
      {
        type: 'FORM_APPLIED',
        fromValue: null,
        toValue: form.type,
        text: `aprobó la solicitud y ${applied.summary}`,
      },
      user,
    );
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

  private assertFormIsPending<
    T extends Pick<Ticket, 'status'> & { form: TicketForm | null },
  >(ticket: T): TicketForm {
    if (!ticket.form) {
      throw new BadRequestException('Este ticket no tiene formulario');
    }
    if (ticket.form.appliedAt) {
      throw new ConflictException('El formulario ya fue aprobado');
    }
    if (FORM_LOCKED_STATUSES.includes(ticket.status)) {
      throw new BadRequestException(
        `No se puede modificar el formulario de un ticket ${TICKET_STATUS_LABELS[ticket.status].toLowerCase()}`,
      );
    }
    return ticket.form;
  }

  private async recordFormChange(
    ticket: Pick<Ticket, 'id' | 'createdById'> & {
      assignees: { userId: string }[];
    },
    entry: ChangeEntry,
    user: RequestUser,
  ) {
    await this.recordEntriesAndNotify(
      ticket.id,
      [entry],
      [ticket.createdById, ...ticket.assignees.map((a) => a.userId)],
      user,
    );

    const updated = await this.prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      ...ticketWithRelations,
    });
    this.ticketsGateway.emitTicketUpdated(updated);

    return updated;
  }

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

  async notifyOverdueTickets(): Promise<{ notified: number }> {
    const now = new Date();
    const overdue = await this.prisma.ticket.findMany({
      where: {
        dueAt: { lt: now },
        overdueNotifiedAt: null,
        status: { notIn: ['RESOLVED', 'CLOSED', 'CANCELLED'] },
      },
      select: { id: true, code: true, title: true, createdById: true },
    });

    for (const ticket of overdue) {
      const message = `El ticket #${ticket.code} "${ticket.title}" venció su tiempo de atención (SLA).`;

      await this.persistAndNotify([ticket.createdById], ticket.id, message);
      this.ticketsGateway.emitOverdueTicket({
        id: ticket.id,
        code: ticket.code,
        title: ticket.title,
      });

      await this.prisma.ticket.update({
        where: { id: ticket.id },
        data: { overdueNotifiedAt: now },
      });
    }

    return { notified: overdue.length };
  }
}
