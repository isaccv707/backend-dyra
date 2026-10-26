import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Category,
  Prisma,
  Ticket,
  TicketFormType,
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
import { computeDueAt } from './constants/ticket-sla.const';
import { TicketCommentsService } from './comments/ticket-comments.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { FindTicketsDto, TicketFormStatus } from './dto/find-tickets.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { TicketNotificationsService } from './notifications/ticket-notifications.service';
import { TicketsGateway } from './tickets.gateway';
import { TicketFormsService } from './forms/ticket-forms.service';
import {
  resolveFormType,
  SUBCATEGORY_FORM_CATEGORIES,
  TICKET_FORM_DEFINITIONS,
} from './forms/ticket-forms.const';
import {
  assigneeIdsOf,
  CATEGORY_LABELS,
  ChangeEntry,
  FORM_LOCKED_STATUSES,
  REOPENABLE_STATUSES,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  ticketWithFullRelations,
  ticketWithRelations,
  TicketWithRelations,
} from './tickets.shared';
import {
  assertTicketAccess,
  hasTicketUpdatePermission,
} from './utils/ticket-access.util';
import { computeTraceabilityFields } from './utils/ticket-traceability.util';

const TICKET_ALLOWED_FIELDS = [
  'code',
  'title',
  'status',
  'priority',
  'category',
  'createdAt',
];

const TICKET_STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CANCELLED'],
  IN_PROGRESS: ['ON_HOLD', 'RESOLVED', 'CANCELLED'],
  ON_HOLD: ['IN_PROGRESS', 'CANCELLED'],
  RESOLVED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: ['IN_PROGRESS'],
  CANCELLED: [],
};

const FORM_STATUS_WHERE: Record<TicketFormStatus, Prisma.TicketWhereInput> = {
  PENDING: {
    form: { appliedAt: null, rejectedAt: null },
    status: { notIn: FORM_LOCKED_STATUSES },
  },
  APPLIED: { form: { appliedAt: { not: null } } },
  REJECTED: { form: { rejectedAt: { not: null } } },
};

/**
 * Tickets a user may create per minute. Counted on created tickets, so a form
 * rejected by validation doesn't use up the quota (the throttler on the route
 * only stops floods).
 */
export const TICKET_CREATE_LIMIT = { count: 10, windowMs: 60_000 };

/**
 * Ticket lifecycle: create, list, detail and status/priority/classification
 * changes. Comments, assignees, forms and notifications live in their own
 * services.
 */
@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketsGateway: TicketsGateway,
    private readonly ticketForms: TicketFormsService,
    private readonly notifications: TicketNotificationsService,
    private readonly comments: TicketCommentsService,
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
      await this.notifications.notifyNewTicket(ticket, user);

      return ticket;
    } catch (error) {
      handleDatabaseErrors(error, 'Ticket');
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

    const onlyMine = dto.mine || !hasTicketUpdatePermission(user);

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

    const canSeeAllTickets = assertTicketAccess(
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

    const traceabilityData = computeTraceabilityFields(ticket, updateTicketDto);

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

    await this.comments.recordChanges(
      previousTicket,
      entries,
      [previousTicket.createdById, ...assigneeIdsOf(updatedTicket)],
      user,
    );
  }

  private assertValidStatusTransition(from: TicketStatus, to: TicketStatus) {
    if (!TICKET_STATUS_TRANSITIONS[from].includes(to)) {
      throw new BadRequestException(
        `No se puede cambiar el estado de "${TICKET_STATUS_LABELS[from]}" a "${TICKET_STATUS_LABELS[to]}"`,
      );
    }
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
}
