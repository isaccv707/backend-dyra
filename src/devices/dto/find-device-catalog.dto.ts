import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { DeviceType } from '@prisma/client';
import { PaginatedQueryDto } from 'src/common/dto/paginated-query.dto';

export class FindDeviceCatalogDto extends PaginatedQueryDto {
  @IsOptional()
  @IsEnum(DeviceType)
  type?: DeviceType;

  // Por defecto el listado solo muestra catálogos activos (isActive=true);
  // pasar true incluye también los archivados, para poder reactivarlos.
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}
