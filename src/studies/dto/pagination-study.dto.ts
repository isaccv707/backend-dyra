import { IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginatedQueryDto } from 'src/common/dto/paginated-query.dto';

export class PaginationDto extends PaginatedQueryDto {
  @IsOptional()
  @IsString()
  priceSheetId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;
}
