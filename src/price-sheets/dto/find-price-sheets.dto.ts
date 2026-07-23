import { IsOptional, IsUUID } from 'class-validator';
import { PaginatedQueryDto } from 'src/common/dto/paginated-query.dto';

export class FindPriceSheetsDto extends PaginatedQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
