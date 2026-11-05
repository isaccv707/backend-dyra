import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma, Ticket, TicketForm } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { assertBranchAccess } from 'src/common/utils/branch-access.util';
import { ChangeEntry, TICKET_STATUS_LABELS } from '../../tickets.shared';
import { computeTraceabilityFields } from '../../utils/ticket-traceability.util';
import { TicketFormApplyResult } from '../ticket-form-handler.interface';
import { TICKET_FORM_DEFINITIONS } from '../ticket-forms.const';
import { purgeFormSecret } from '../ticket-form-secret.service';
import { TicketFormsService } from '../ticket-forms.service';
import { TicketFormStateService } from './ticket-form-state.service';
import { FORM_WORKFLOW_LOG_CONTEXT } from './ticket-form-workflow.const';

/** Thrown inside a dry-run transaction to roll it back with its result. */
class DryRunRollback extends Error {
  constructor(readonly result: TicketFormApplyResult) {
    super('dry run');
  }
}

/** Applying a form may create a panel with its children: more than the 5 s default. */
const FORM_APPLY_TIMEOUT_MS = 30_000;

/** IT decides on a form: validate (dry run), approve (runs its action) or reject. */
@Injectable()
export class TicketFormDecisionService {
  private readonly logger = new Logger(FORM_WORKFLOW_LOG_CONTEXT);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketForms: TicketFormsService,
    private readonly state: TicketFormStateService,
  ) {}

  /** Checks shared by approving and validating a form. */
  private async findApplicableForm(id: string, user: RequestUser) {
    const ticket = await this.state.findTicketWithForm(id);
    assertBranchAccess(user, ticket.branchId);
    const form = this.state.assertFormIsPending(ticket);

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

    return this.state.recordFormChange(ticket, entries, user);
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
    const ticket = await this.state.findTicketWithForm(id);
    assertBranchAccess(user, ticket.branchId);
    const form = this.state.assertFormIsPending(ticket);

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
      await purgeFormSecret(tx, id);
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
    return this.state.recordFormChange(ticket, entries, user);
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
}
