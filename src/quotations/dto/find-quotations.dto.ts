import { IsOptional, IsUUID } from 'class-validator';
import { PaginatedQueryDto } from 'src/common/dto/paginated-query.dto';

export class FindQuotationsDto extends PaginatedQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
