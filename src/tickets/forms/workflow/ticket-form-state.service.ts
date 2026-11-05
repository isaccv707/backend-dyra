import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Ticket, TicketForm } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { TicketCommentsService } from '../../comments/ticket-comments.service';
import { TicketsGateway } from '../../tickets.gateway';
import {
  ChangeEntry,
  FORM_LOCKED_STATUSES,
  TICKET_STATUS_LABELS,
  ticketWithRelations,
} from '../../tickets.shared';
import { FORM_WORKFLOW_LOG_CONTEXT } from './ticket-form-workflow.const';

/** Ticket lookups, the pending check and the change history shared by every step. */
@Injectable()
export class TicketFormStateService {
  private readonly logger = new Logger(FORM_WORKFLOW_LOG_CONTEXT);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketsGateway: TicketsGateway,
    private readonly comments: TicketCommentsService,
  ) {}

  findTicketSummary(id: string) {
    return this.prisma.ticket.findUniqueOrThrow({
      where: { id },
      ...ticketWithRelations,
    });
  }

  async findTicketWithForm(id: string) {
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

  assertFormIsPending(
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

  async recordFormChange(
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
      await this.comments.recordChanges(
        { ...ticket, assigneeIds: ticket.assignees.map((a) => a.userId) },
        entries,
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
}
