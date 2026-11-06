import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { TicketPriority } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { assertBranchAccess } from 'src/common/utils/branch-access.util';
import { computeDueAt } from '../constants/ticket-sla.const';
import { CreateTicketDto } from '../dto/create-ticket.dto';
import { TicketFormsService } from '../forms/ticket-forms.service';
import { TICKET_FORM_DEFINITIONS } from '../forms/ticket-forms.const';
import { TicketNotificationsService } from '../notifications/ticket-notifications.service';
import { TicketsGateway } from '../tickets.gateway';
import { ticketWithRelations } from '../tickets.shared';
import { TicketClassificationService } from './ticket-classification.service';

/**
 * Tickets a user may create per minute. Counted on created tickets, so a form
 * rejected by validation doesn't use up the quota (the throttler on the route
 * only stops floods).
 */
export const TICKET_CREATE_LIMIT = { count: 10, windowMs: 60_000 };

/** Creates a ticket: classification, form, per-branch folio and notices. */
@Injectable()
export class TicketCreateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketsGateway: TicketsGateway,
    private readonly ticketForms: TicketFormsService,
    private readonly notifications: TicketNotificationsService,
    private readonly classification: TicketClassificationService,
  ) {}

  async create(createTicketDto: CreateTicketDto, user: RequestUser) {
    const { form, ...ticketData } = createTicketDto;
    assertBranchAccess(user, ticketData.branchId);
    await this.assertCreateQuota(user.id);

    const formType = await this.classification.resolveTicketFormType(
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
                    ...parsedForm.secretColumns,
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
}
