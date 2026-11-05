import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { userBranchFilter } from 'src/common/utils/branch-access.util';
import {
  buildPaginatedQuery,
  paginatedResponse,
} from 'src/common/utils/paginate.util';
import { FindTicketsDto, TicketFormStatus } from '../dto/find-tickets.dto';
import {
  assigneeIdsOf,
  FORM_LOCKED_STATUSES,
  ticketWithFullRelations,
  ticketWithRelations,
} from '../tickets.shared';
import {
  assertTicketAccess,
  hasTicketUpdatePermission,
} from '../utils/ticket-access.util';

const TICKET_ALLOWED_FIELDS = [
  'code',
  'title',
  'status',
  'priority',
  'category',
  'createdAt',
];

const FORM_STATUS_WHERE: Record<TicketFormStatus, Prisma.TicketWhereInput> = {
  PENDING: {
    form: { appliedAt: null, rejectedAt: null },
    status: { notIn: FORM_LOCKED_STATUSES },
  },
  APPLIED: { form: { appliedAt: { not: null } } },
  REJECTED: { form: { rejectedAt: { not: null } } },
};

/**
 * Title/description contain the term (trigram-indexed ILIKE); "123" or "#123"
 * also matches that folio.
 */
export function ticketSearchWhere(search?: string): Prisma.TicketWhereInput {
  const term = search?.trim();
  if (!term) return {};

  const folio = /^#?(\d{1,9})$/.exec(term);
  return {
    OR: [
      ...(folio ? [{ code: Number(folio[1]) }] : []),
      { title: { contains: term, mode: 'insensitive' } },
      { description: { contains: term, mode: 'insensitive' } },
    ],
  };
}

/** Ticket list (with visibility rules) and detail. */
@Injectable()
export class TicketQueryService {
  constructor(private readonly prisma: PrismaService) {}

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
    // Search is built here (ticketSearchWhere) to also match the folio.
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: [],
      defaultSort: { createdAt: 'desc' },
      allowedFields: TICKET_ALLOWED_FIELDS,
    });

    const onlyMine = dto.mine || !hasTicketUpdatePermission(user);

    const conditions: Prisma.TicketWhereInput[] = [
      where as Prisma.TicketWhereInput,
      ticketSearchWhere(dto.search),
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
}
