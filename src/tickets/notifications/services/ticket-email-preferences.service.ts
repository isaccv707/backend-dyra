import { Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { UpdateTicketEmailPreferencesDto } from '../../dto/ticket-email-preferences.dto';
import {
  TICKET_EMAIL_EVENT_LABELS,
  TICKET_EMAIL_EVENTS,
} from '../ticket-notification-rules';
import { unique } from '../ticket-notification.types';

/** Which ticket emails each user turned off (the in-app notice always arrives). */
@Injectable()
export class TicketEmailPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async getEmailPreferences(user: RequestUser) {
    const pref = await this.prisma.ticketEmailPreference.findUnique({
      where: { userId: user.id },
    });
    const muted = new Set(pref?.mutedEvents ?? []);
    return TICKET_EMAIL_EVENTS.map((event) => ({
      event,
      label: TICKET_EMAIL_EVENT_LABELS[event],
      enabled: !muted.has(event),
    }));
  }

  async updateEmailPreferences(
    user: RequestUser,
    dto: UpdateTicketEmailPreferencesDto,
  ) {
    const mutedEvents = unique(dto.mutedEvents);
    await this.prisma.ticketEmailPreference.upsert({
      where: { userId: user.id },
      create: { userId: user.id, mutedEvents },
      update: { mutedEvents },
    });
    return this.getEmailPreferences(user);
  }
}
