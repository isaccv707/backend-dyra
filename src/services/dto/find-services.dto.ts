import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { PaginatedQueryDto } from 'src/common/dto/paginated-query.dto';

export const toBoolean = ({ value }: { value: unknown }) =>
  value === true || value === 'true'
    ? true
    : value === false || value === 'false'
      ? false
      : value;

export class FindServicesDto extends PaginatedQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  priceSheetId?: string;

  /** true = solo perfiles (paneles), false = solo estudios individuales. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isPanel?: boolean;
}
