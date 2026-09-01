import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { assertBranchAccess, BranchScopedUser, userBranchFilter } from 'src/common/utils/branch-access.util';
import { buildPaginatedQuery, paginatedResponse } from 'src/common/utils/paginate.util';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { FindTicketsDto } from './dto/find-tickets.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { TicketsGateway } from './tickets.gateway';

const TICKET_ALLOWED_FIELDS = ['code', 'title', 'status', 'priority', 'category', 'createdAt'];

const ticketWithRelations = Prisma.validator<Prisma.TicketDefaultArgs>()({
  include: {
    branch: { select: { id: true, name: true } },
    createdBy: { select: { id: true, name: true, email: true } },
    assignedTo: { select: { id: true, name: true, email: true } },
    attachments: true,
  },
});

export type TicketWithRelations = Prisma.TicketGetPayload<typeof ticketWithRelations>;

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketsGateway: TicketsGateway,
  ) {}

  async create(createTicketDto: CreateTicketDto, user: BranchScopedUser & { id: string }) {
    assertBranchAccess(user, createTicketDto.branchId);

    try {
      const { attachments, ...ticketData } = createTicketDto;

      const ticket = await this.prisma.ticket.create({
        data: {
          ...ticketData,
          createdById: user.id,
          attachments: attachments?.length ? { create: attachments } : undefined,
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
      this.prisma.ticket.findMany({ skip, take, where: finalWhere, orderBy, ...ticketWithRelations }),
      this.prisma.ticket.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOne(id: string, user: BranchScopedUser) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id }, ...ticketWithRelations });
    if (!ticket) {
      throw new NotFoundException(`Ticket with ID '${id}' not found`);
    }
    assertBranchAccess(user, ticket.branchId);

    return ticket;
  }

  async update(id: string, updateTicketDto: UpdateTicketDto, user: BranchScopedUser) {
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
          ...(updateTicketDto.priority && { priority: updateTicketDto.priority }),
          ...(updateTicketDto.assignedToId !== undefined && {
            assignedToId: updateTicketDto.assignedToId,
          }),
        },
        ...ticketWithRelations,
      });

      this.ticketsGateway.emitTicketUpdated(updated);

      return updated;
    } catch (error) {
      handleDatabaseErrors(error, 'Ticket');
    }
  }
}
