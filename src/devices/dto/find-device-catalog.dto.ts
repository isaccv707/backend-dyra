import { IsEnum, IsOptional } from 'class-validator';
import { DeviceType } from '@prisma/client';
import { PaginatedQueryDto } from 'src/common/dto/paginated-query.dto';

export class FindDeviceCatalogDto extends PaginatedQueryDto {
  @IsOptional()
  @IsEnum(DeviceType)
  type?: DeviceType;
}
