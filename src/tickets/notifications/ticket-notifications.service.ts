import { Injectable } from '@nestjs/common';
import { Ticket, TicketNotificationKind } from '@prisma/client';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { FindTicketNotificationsDto } from '../dto/find-ticket-notifications.dto';
import { UpdateTicketEmailPreferencesDto } from '../dto/ticket-email-preferences.dto';
import { TicketWithRelations } from '../tickets.shared';
import { TicketEmailPreferencesService } from './services/ticket-email-preferences.service';
import { TicketNotificationDispatchService } from './services/ticket-notification-dispatch.service';
import { TicketNotificationInboxService } from './services/ticket-notification-inbox.service';
import { TicketNotificationEvent } from './ticket-notification-rules';
import { DispatchOptions, NotifiableTicket } from './ticket-notification.types';

export { NOTIFICATION_RETENTION_DAYS } from './services/ticket-notification-inbox.service';
export type {
  DispatchOptions,
  NotifiableTicket,
} from './ticket-notification.types';

/**
 * Ticket notices for the rest of the tickets module: who gets each event,
 * email preferences and each user's inbox. Holds no logic: each part lives in
 * `services/`.
 */
@Injectable()
export class TicketNotificationsService {
  constructor(
    private readonly dispatcher: TicketNotificationDispatchService,
    private readonly preferences: TicketEmailPreferencesService,
    private readonly inbox: TicketNotificationInboxService,
  ) {}

  // Dispatch

  dispatch(
    event: TicketNotificationEvent,
    ticket: NotifiableTicket,
    options: DispatchOptions,
  ) {
    return this.dispatcher.dispatch(event, ticket, options);
  }

  findTiStaff(branchId: string) {
    return this.dispatcher.findTiStaff(branchId);
  }

  notify(
    userIds: (string | null | undefined)[],
    ticket: Pick<Ticket, 'id' | 'code' | 'title'>,
    notification: {
      kind: TicketNotificationKind;
      message: string;
      actorId?: string;
    },
  ) {
    return this.dispatcher.notify(userIds, ticket, notification);
  }

  notifyNewTicket(ticket: TicketWithRelations, user: RequestUser) {
    return this.dispatcher.notifyNewTicket(ticket, user);
  }

  // Email preferences

  getEmailPreferences(user: RequestUser) {
    return this.preferences.getEmailPreferences(user);
  }

  updateEmailPreferences(
    user: RequestUser,
    dto: UpdateTicketEmailPreferencesDto,
  ) {
    return this.preferences.updateEmailPreferences(user, dto);
  }

  // Inbox

  findMine(dto: FindTicketNotificationsDto, user: RequestUser) {
    return this.inbox.findMine(dto, user);
  }

  markRead(id: string, user: RequestUser) {
    return this.inbox.markRead(id, user);
  }

  markAllRead(user: RequestUser) {
    return this.inbox.markAllRead(user);
  }

  remove(id: string, user: RequestUser) {
    return this.inbox.remove(id, user);
  }

  purgeMine(user: RequestUser, all?: boolean) {
    return this.inbox.purgeMine(user, all);
  }

  purgeOld(now?: Date) {
    return this.inbox.purgeOld(now);
  }
}
