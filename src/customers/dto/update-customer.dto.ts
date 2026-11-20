import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateCustomerDto } from './create-customer.dto';

/** Todos los campos opcionales; la sucursal no se puede cambiar. */
export class UpdateCustomerDto extends PartialType(
  OmitType(CreateCustomerDto, ['branchId'] as const),
) {}
