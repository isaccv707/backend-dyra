import { TicketFormAccessService } from './ticket-form-access.service';
import { TicketFormDecisionService } from './ticket-form-decision.service';
import { TicketFormEditService } from './ticket-form-edit.service';
import { TicketFormStateService } from './ticket-form-state.service';

/** Sub-services of TicketFormWorkflowService, for the module and the test context. */
export const TICKET_FORM_WORKFLOW_PROVIDERS = [
  TicketFormStateService,
  TicketFormEditService,
  TicketFormDecisionService,
  TicketFormAccessService,
];
