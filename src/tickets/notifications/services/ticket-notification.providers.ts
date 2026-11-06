import { TicketEmailPreferencesService } from './ticket-email-preferences.service';
import { TicketNotificationDispatchService } from './ticket-notification-dispatch.service';
import { TicketNotificationInboxService } from './ticket-notification-inbox.service';

/** Sub-services of TicketNotificationsService, for the module and the test context. */
export const TICKET_NOTIFICATION_PROVIDERS = [
  TicketNotificationDispatchService,
  TicketEmailPreferencesService,
  TicketNotificationInboxService,
];
