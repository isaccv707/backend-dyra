import { BadRequestException, Injectable } from '@nestjs/common';
import { ClientCreateFormDto } from '../dto/client-create-form.dto';
import {
  TicketFormContext,
  TicketFormDb,
  TicketFormHandler,
} from '../ticket-form-handler.interface';
import { ticketTitle } from '../ticket-forms.const';

/** Informative: IT registers the client outside the system. */
@Injectable()
export class ClientCreateFormHandler implements TicketFormHandler<ClientCreateFormDto> {
  readonly type = 'CLIENT_CREATE' as const;
  readonly dataDto = ClientCreateFormDto;

  async validate(
    data: ClientCreateFormDto,
    { branchId }: TicketFormContext,
    db: TicketFormDb,
  ) {
    const priceSheet = await db.priceSheets.findFirst({
      where: { id: data.priceSheetId, branchId, isActive: true },
      select: { id: true },
    });
    if (!priceSheet) {
      throw new BadRequestException(
        'form.priceSheetId: el tarifario no existe, está inactivo o pertenece a otra sucursal',
      );
    }

    return { title: ticketTitle('Alta de cliente', data.name) };
  }
}
