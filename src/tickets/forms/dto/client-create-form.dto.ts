import { OmitType } from '@nestjs/swagger';
import { CreateCustomerDto } from 'src/customers/dto/create-customer.dto';

/**
 * Same fields as CreateCustomerDto; the branch is the ticket's and the client
 * is created active. accountsReceivable (genera CxC) and liquidate (liquida al
 * instante) are mutually exclusive.
 *
 * Version 2 (version 1 used `receivable` / `payInCash` and a required
 * priceSheetId; see TICKET_FORM_UPGRADES).
 */
export class ClientCreateFormDto extends OmitType(CreateCustomerDto, [
  'branchId',
  'isActive',
] as const) {}

/** IT doesn't capture anything when approving: the client is created as requested. */
export class ApplyClientCreateFormDto {}
