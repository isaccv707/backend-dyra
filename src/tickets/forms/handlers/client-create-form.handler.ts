import { Injectable } from '@nestjs/common';
import { CustomersService } from 'src/customers/customers.service';
import {
  ApplyClientCreateFormDto,
  ClientCreateFormDto,
} from '../dto/client-create-form.dto';
import {
  TicketFormApplyResult,
  TicketFormContext,
  TicketFormDb,
  TicketFormHandler,
} from '../ticket-form-handler.interface';
import { ticketTitle } from '../ticket-forms.const';

/** Creates the client (Customer) in the ticket's branch when IT approves. */
@Injectable()
export class ClientCreateFormHandler implements TicketFormHandler<
  ClientCreateFormDto,
  ApplyClientCreateFormDto
> {
  readonly type = 'CLIENT_CREATE' as const;
  readonly dataDto = ClientCreateFormDto;
  readonly applyDto = ApplyClientCreateFormDto;

  constructor(private readonly customers: CustomersService) {}

  private toCreateDto(data: ClientCreateFormDto, branchId: string) {
    return { ...data, branchId, isActive: true };
  }

  async validate(
    data: ClientCreateFormDto,
    context: TicketFormContext,
    db: TicketFormDb,
  ) {
    await this.customers.prepareCreate(
      this.toCreateDto(data, context.branchId),
      context.actor,
      db,
    );
    return { title: ticketTitle('Alta de cliente', data.name) };
  }

  async apply(
    data: ClientCreateFormDto,
    _applyData: ApplyClientCreateFormDto,
    context: TicketFormContext,
    tx: TicketFormDb,
  ): Promise<TicketFormApplyResult> {
    const customer = await this.customers.create(
      this.toCreateDto(data, context.branchId),
      context.actor,
      tx,
    );
    // create() only returns undefined when it throws.
    const { id, name } = customer!;
    return {
      result: { customerId: id, name },
      summary: `dio de alta el cliente "${name}"`,
    };
  }
}
