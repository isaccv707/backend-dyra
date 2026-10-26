import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, Ticket, TicketForm } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { assertBranchAccess } from 'src/common/utils/branch-access.util';
import { MailService } from 'src/mail/mail.service';
import { TicketCommentsService } from '../comments/ticket-comments.service';
import { TicketsGateway } from '../tickets.gateway';
import {
  ChangeEntry,
  FORM_LOCKED_STATUSES,
  TICKET_STATUS_LABELS,
  ticketWithRelations,
} from '../tickets.shared';
import { hasTicketUpdatePermission } from '../utils/ticket-access.util';
import { computeTraceabilityFields } from '../utils/ticket-traceability.util';
import { TicketFormApplyResult } from './ticket-form-handler.interface';
import {
  PRIVILEGED_PERMISSION_MODULES,
  TICKET_FORM_DEFINITIONS,
} from './ticket-forms.const';
import { TicketFormsService } from './ticket-forms.service';

/** Thrown inside a dry-run transaction to roll it back with its result. */
class DryRunRollback extends Error {
  constructor(readonly result: TicketFormApplyResult) {
    super('dry run');
  }
}

/** Applying a form may create a panel with its children: more than the 5 s default. */
const FORM_APPLY_TIMEOUT_MS = 30_000;

/**
 * Lifecycle of a ticket's form: the requester edits it while pending, IT
 * validates, approves (runs its action) or rejects it.
 */
@Injectable()
export class TicketFormWorkflowService {
  private readonly logger = new Logger(TicketFormWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketsGateway: TicketsGateway,
    private readonly mailService: MailService,
    private readonly ticketForms: TicketFormsService,
    private readonly comments: TicketCommentsService,
  ) {}

  async updateForm(id: string, payload: unknown, user: RequestUser) {
    const ticket = await this.findTicketWithForm(id);

    if (hasTicketUpdatePermission(user)) {
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
                ...computeTraceabilityFields(ticket, { status: 'RESOLVED' }),
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
            ...computeTraceabilityFields(ticket, { status: 'CANCELLED' }),
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
      await this.comments.recordChanges(
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
}
