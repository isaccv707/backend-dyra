import { Injectable } from '@nestjs/common';
import { SoftwareRemoteFormDto } from '../dto/software-remote-form.dto';
import {
  TicketFormHandler,
  TicketFormValidation,
} from '../ticket-form-handler.interface';

/** Informative: the requester also writes title and description. */
@Injectable()
export class SoftwareRemoteFormHandler implements TicketFormHandler<SoftwareRemoteFormDto> {
  readonly type = 'SOFTWARE_REMOTE' as const;
  readonly dataDto = SoftwareRemoteFormDto;

  validate(): Promise<TicketFormValidation> {
    return Promise.resolve({});
  }
}
