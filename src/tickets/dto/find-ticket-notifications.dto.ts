import { Type } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginatedQueryDto } from 'src/common/dto/paginated-query.dto';

export class FindTicketNotificationsDto extends PaginatedQueryDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  read?: boolean;
}
