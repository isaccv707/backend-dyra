import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginatedQueryDto } from 'src/common/dto/paginated-query.dto';

export class FindTicketNotificationsDto extends PaginatedQueryDto {
  @IsOptional()
  // Query params are strings: @Type(() => Boolean) turns "false" into true.
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  read?: boolean;
}

export class PurgeTicketNotificationsDto {
  /** true: también las no leídas. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  all?: boolean;
}
