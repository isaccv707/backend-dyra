import { TicketClassificationService } from './ticket-classification.service';
import { TicketCreateService } from './ticket-create.service';
import { TicketQueryService } from './ticket-query.service';
import { TicketUpdateService } from './ticket-update.service';

/** Sub-services of TicketsService, for the module and the test context. */
export const TICKET_LIFECYCLE_PROVIDERS = [
  TicketClassificationService,
  TicketCreateService,
  TicketQueryService,
  TicketUpdateService,
];
