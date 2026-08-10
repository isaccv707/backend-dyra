import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { TransferStatus } from '@prisma/client';
import { PaginatedQueryDto } from 'src/common/dto/paginated-query.dto';

export class FindTransfersDto extends PaginatedQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsEnum(TransferStatus)
  status?: TransferStatus;
}
