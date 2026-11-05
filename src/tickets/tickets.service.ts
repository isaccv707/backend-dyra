import { Injectable } from '@nestjs/common';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { FindTicketsDto } from './dto/find-tickets.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { TicketCreateService } from './services/ticket-create.service';
import { TicketQueryService } from './services/ticket-query.service';
import { TicketUpdateService } from './services/ticket-update.service';

export { TICKET_CREATE_LIMIT } from './services/ticket-create.service';
export { ticketSearchWhere } from './services/ticket-query.service';

/**
 * Ticket lifecycle: create, list, detail and status/priority/classification
 * changes. Holds no logic: each operation lives in `services/`. Comments,
 * assignees, forms and notifications live in their own services.
 */
@Injectable()
export class TicketsService {
  constructor(
    private readonly creation: TicketCreateService,
    private readonly query: TicketQueryService,
    private readonly updates: TicketUpdateService,
  ) {}

  create(createTicketDto: CreateTicketDto, user: RequestUser) {
    return this.creation.create(createTicketDto, user);
  }

  findAll(dto: FindTicketsDto, user: RequestUser) {
    return this.query.findAll(dto, user);
  }

  findOne(id: string, user: RequestUser) {
    return this.query.findOne(id, user);
  }

  update(id: string, updateTicketDto: UpdateTicketDto, user: RequestUser) {
    return this.updates.update(id, updateTicketDto, user);
  }
}
