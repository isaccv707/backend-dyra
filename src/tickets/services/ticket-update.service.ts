import { Injectable, NotFoundException } from '@nestjs/common';
import { Ticket } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { assertBranchAccess } from 'src/common/utils/branch-access.util';
import { TicketCommentsService } from '../comments/ticket-comments.service';
import { UpdateTicketDto } from '../dto/update-ticket.dto';
import { purgeFormSecret } from '../forms/ticket-form-secret.service';
import { TicketsGateway } from '../tickets.gateway';
import {
  assigneeIdsOf,
  CATEGORY_LABELS,
  ChangeEntry,
  FORM_SECRET_STATUSES,
  REOPENABLE_STATUSES,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  ticketWithRelations,
  TicketWithRelations,
} from '../tickets.shared';
import { computeTraceabilityFields } from '../utils/ticket-traceability.util';
import { TicketClassificationService } from './ticket-classification.service';

/** Status, priority and classification changes, with their history entries. */
@Injectable()
export class TicketUpdateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketsGateway: TicketsGateway,
    private readonly comments: TicketCommentsService,
    private readonly classification: TicketClassificationService,
  ) {}

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
      this.classification.assertValidStatusTransition(
        ticket.status,
        updateTicketDto.status,
      );
    }

    if (updateTicketDto.subcategoryId) {
      await this.classification.assertSubcategoryBelongsToCategory(
        updateTicketDto.subcategoryId,
        updateTicketDto.category ?? ticket.category,
      );
    }
    await this.classification.assertFormKeptOnReclassify(
      ticket,
      updateTicketDto,
    );

    const traceabilityData = computeTraceabilityFields(ticket, updateTicketDto);

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        // Before the update, so the returned form already shows it's gone.
        if (
          updateTicketDto.status &&
          !FORM_SECRET_STATUSES.includes(updateTicketDto.status)
        ) {
          await purgeFormSecret(tx, id);
        }
        return tx.ticket.update({
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
      { ...previousTicket, assigneeIds: assigneeIdsOf(updatedTicket) },
      entries,
      user,
    );
  }
}
