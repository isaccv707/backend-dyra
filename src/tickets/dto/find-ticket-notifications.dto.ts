import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginatedQueryDto } from 'src/common/dto/paginated-query.dto';

export class FindTicketNotificationsDto extends PaginatedQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  read?: boolean;
}
