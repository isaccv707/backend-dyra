import { IsOptional, IsUUID } from 'class-validator';
import { PaginatedQueryDto } from 'src/common/dto/paginated-query.dto';

export class FindReviewsDto extends PaginatedQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
