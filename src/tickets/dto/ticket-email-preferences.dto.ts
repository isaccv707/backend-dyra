import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsIn } from 'class-validator';
import {
  TICKET_EMAIL_EVENTS,
  type TicketEmailEvent,
} from '../notifications/ticket-notification-rules';

export class UpdateTicketEmailPreferencesDto {
  /** Email events the user doesn't want; the in-app notice still arrives. */
  @ApiProperty({ enum: TICKET_EMAIL_EVENTS, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsIn(TICKET_EMAIL_EVENTS, {
    each: true,
    message: `mutedEvents solo acepta: ${TICKET_EMAIL_EVENTS.join(', ')}`,
  })
  mutedEvents!: TicketEmailEvent[];
}

export class TicketEmailPreferenceDto {
  @ApiProperty({ enum: TICKET_EMAIL_EVENTS })
  event!: TicketEmailEvent;
  label!: string;
  enabled!: boolean;
}
