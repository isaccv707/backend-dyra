import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { assertBranchAccess } from 'src/common/utils/branch-access.util';
import {
  FORM_LOCKED_STATUSES,
  FORM_SECRET_STATUSES,
  FORM_SECRET_VISIBLE_STATUS,
} from '../../tickets.shared';
import { hasTicketUpdatePermission } from '../../utils/ticket-access.util';
import { TICKET_FORM_DEFINITIONS } from '../ticket-forms.const';
import { TicketFormSecretService } from '../ticket-form-secret.service';
import { TicketFormsService } from '../ticket-forms.service';
import { TicketFormStateService } from './ticket-form-state.service';
import { FORM_WORKFLOW_LOG_CONTEXT } from './ticket-form-workflow.const';

/** The requester (or IT) edits a pending form; who attends reads its secret. */
@Injectable()
export class TicketFormEditService {
  private readonly logger = new Logger(FORM_WORKFLOW_LOG_CONTEXT);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketForms: TicketFormsService,
    private readonly secrets: TicketFormSecretService,
    private readonly state: TicketFormStateService,
  ) {}

  async updateForm(id: string, payload: unknown, user: RequestUser) {
    const ticket = await this.state.findTicketWithForm(id);

    if (hasTicketUpdatePermission(user)) {
      assertBranchAccess(user, ticket.branchId);
    } else if (ticket.createdById !== user.id) {
      throw new ForbiddenException(
        'Solo quien reportó el ticket o TI pueden editar el formulario',
      );
    }

    const form = this.state.assertFormIsPending(ticket);
    const { data, title, secretColumns } = await this.ticketForms.parse(
      form.type,
      payload,
      {
        branchId: ticket.branchId,
        actor: user,
        phase: 'request',
      },
    );
    if (secretColumns && !FORM_SECRET_STATUSES.includes(ticket.status)) {
      throw new BadRequestException(
        'La contraseña solo se registra con el ticket abierto o en progreso',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Only while pending: an approval or a status change may have committed
      // since the read above, and a ticket out of attention must not get its
      // secret back.
      const { count } = await tx.ticketForm.updateMany({
        where: {
          ticketId: id,
          appliedAt: null,
          rejectedAt: null,
          ticket: {
            status: secretColumns
              ? { in: FORM_SECRET_STATUSES }
              : { notIn: FORM_LOCKED_STATUSES },
          },
        },
        // Saved by the current DTOs: it's now data of the current version.
        data: {
          data,
          schemaVersion: TICKET_FORM_DEFINITIONS[form.type].version,
          ...secretColumns,
        },
      });
      if (count === 0) {
        throw new ConflictException('El formulario ya no se puede modificar');
      }
      // Forms that generate the title keep it in sync with their data.
      if (title && title !== ticket.title) {
        await tx.ticket.update({ where: { id }, data: { title } });
      }
    });

    return this.state.recordFormChange(
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

  /**
   * Decrypts the form's secret for whoever attends the ticket: IT of its branch
   * or an assignee, only while it's in progress. Not the requester, who already
   * knows it and can replace it.
   */
  async revealSecret(id: string, user: RequestUser) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      select: {
        branchId: true,
        status: true,
        assignees: { select: { userId: true } },
        form: { select: { encryptedSecret: true } },
      },
    });
    if (!ticket) {
      throw new NotFoundException(`Ticket with ID '${id}' not found`);
    }

    if (hasTicketUpdatePermission(user)) {
      assertBranchAccess(user, ticket.branchId);
    } else if (!ticket.assignees.some((a) => a.userId === user.id)) {
      throw new ForbiddenException(
        'Solo TI o quien atiende el ticket pueden ver la contraseña',
      );
    }

    if (ticket.status !== FORM_SECRET_VISIBLE_STATUS) {
      throw new ConflictException(
        'La contraseña solo se muestra con el ticket en progreso',
      );
    }
    if (!ticket.form?.encryptedSecret) {
      throw new NotFoundException(
        'Este ticket no tiene una contraseña guardada',
      );
    }

    this.logger.log(`Usuario ${user.id} consultó el secreto del ticket ${id}`);
    try {
      return { secret: this.secrets.decrypt(ticket.form.encryptedSecret) };
    } catch (error) {
      // Only the message: never what was being decrypted.
      this.logger.error(
        `No se pudo descifrar el secreto del ticket ${id}: ${(error as Error).message}`,
      );
      throw new InternalServerErrorException(
        'No se pudo descifrar la contraseña: pide que la registren de nuevo',
      );
    }
  }
}
