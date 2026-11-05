import { Injectable } from '@nestjs/common';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { TicketFormAccessService } from './workflow/ticket-form-access.service';
import { TicketFormDecisionService } from './workflow/ticket-form-decision.service';
import { TicketFormEditService } from './workflow/ticket-form-edit.service';

/**
 * Lifecycle of a ticket's form: the requester edits it while pending, IT
 * validates, approves (runs its action) or rejects it. Holds no logic: each
 * step lives in `workflow/`.
 */
@Injectable()
export class TicketFormWorkflowService {
  constructor(
    private readonly edits: TicketFormEditService,
    private readonly decisions: TicketFormDecisionService,
    private readonly access: TicketFormAccessService,
  ) {}

  updateForm(id: string, payload: unknown, user: RequestUser) {
    return this.edits.updateForm(id, payload, user);
  }

  revealSecret(id: string, user: RequestUser) {
    return this.edits.revealSecret(id, user);
  }

  applyForm(id: string, payload: unknown, user: RequestUser) {
    return this.decisions.applyForm(id, payload, user);
  }

  validateForm(id: string, payload: unknown, user: RequestUser) {
    return this.decisions.validateForm(id, payload, user);
  }

  rejectForm(id: string, reason: string, user: RequestUser) {
    return this.decisions.rejectForm(id, reason, user);
  }

  resendAccessEmail(id: string, user: RequestUser) {
    return this.access.resendAccessEmail(id, user);
  }

  findFormRoles() {
    return this.access.findFormRoles();
  }
}
