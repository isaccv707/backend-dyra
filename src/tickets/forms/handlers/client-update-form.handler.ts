import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CustomersService } from 'src/customers/customers.service';
import { toCustomerResponse } from 'src/customers/utils/customer.util';
import {
  ApplyClientUpdateFormDto,
  ClientUpdateFormDto,
} from '../dto/client-update-form.dto';
import {
  TicketFormApplyResult,
  TicketFormContext,
  TicketFormDb,
  TicketFormHandler,
} from '../ticket-form-handler.interface';
import { ticketTitle } from '../ticket-forms.const';

function splitForm(data: ClientUpdateFormDto) {
  const { customerId, ...rest } = data;
  const changes = Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined),
  ) as Omit<ClientUpdateFormDto, 'customerId'>;
  return { customerId, changes };
}

const toJson = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/** Updates an existing client of the ticket's branch when IT approves. */
@Injectable()
export class ClientUpdateFormHandler implements TicketFormHandler<
  ClientUpdateFormDto,
  ApplyClientUpdateFormDto
> {
  readonly type = 'CLIENT_UPDATE' as const;
  readonly dataDto = ClientUpdateFormDto;
  readonly applyDto = ApplyClientUpdateFormDto;

  constructor(private readonly customers: CustomersService) {}

  private async assertValid(
    data: ClientUpdateFormDto,
    context: TicketFormContext,
    db: TicketFormDb,
  ) {
    const { customerId, changes } = splitForm(data);
    if (!Object.keys(changes).length) {
      throw new BadRequestException(
        'form: indica al menos un dato a actualizar',
      );
    }

    const { current } = await this.customers.prepareUpdate(
      customerId,
      changes,
      context.actor,
      db,
    );
    if (current.branchId !== context.branchId) {
      throw new BadRequestException(
        'form.customerId: el cliente pertenece a otra sucursal distinta a la del ticket',
      );
    }
    return { current, changes };
  }

  async validate(
    data: ClientUpdateFormDto,
    context: TicketFormContext,
    db: TicketFormDb,
  ) {
    const { current } = await this.assertValid(data, context, db);
    return { title: ticketTitle('Actualización de cliente', current.name) };
  }

  async apply(
    data: ClientUpdateFormDto,
    _applyData: ApplyClientUpdateFormDto,
    context: TicketFormContext,
    tx: TicketFormDb,
  ): Promise<TicketFormApplyResult> {
    const { current, changes } = await this.assertValid(data, context, tx);
    const updated = await this.customers.update(
      data.customerId,
      changes,
      context.actor,
      tx,
    );

    // Before/after of every field that may change (the payment mode moves as a pair).
    const before = toCustomerResponse(current);
    const keys = [
      ...new Set([
        ...Object.keys(changes),
        ...('accountsReceivable' in changes || 'liquidate' in changes
          ? ['accountsReceivable', 'liquidate']
          : []),
      ]),
    ] as (keyof typeof before)[];
    const pick = (source: typeof before) =>
      Object.fromEntries(keys.map((key) => [key, source[key]]));

    return {
      result: {
        customerId: data.customerId,
        name: updated!.name,
        before: toJson(pick(before)),
        after: toJson(pick(updated!)),
      },
      summary: `actualizó el cliente "${updated!.name}"`,
    };
  }
}
