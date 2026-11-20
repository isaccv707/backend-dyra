import { IsUUID } from 'class-validator';
import { UpdateCustomerDto } from 'src/customers/dto/update-customer.dto';

/**
 * Same fields as UpdateCustomerDto: only the fields sent change (null clears
 * priceSheetId, amounts and dates). The client must belong to the ticket's
 * branch.
 */
export class ClientUpdateFormDto extends UpdateCustomerDto {
  @IsUUID()
  customerId!: string;
}

/** IT doesn't capture anything when approving: the changes are applied as requested. */
export class ApplyClientUpdateFormDto {}
