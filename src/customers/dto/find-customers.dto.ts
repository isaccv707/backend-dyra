import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { PaginatedQueryDto } from 'src/common/dto/paginated-query.dto';

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

export class FindCustomersDto extends PaginatedQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;

  /** true = solo clientes con cuenta por cobrar; false = solo los que liquidan. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  accountsReceivable?: boolean;

  @IsOptional()
  @IsUUID()
  priceSheetId?: string;
}
