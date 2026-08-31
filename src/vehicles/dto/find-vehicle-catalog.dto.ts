import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginatedQueryDto } from 'src/common/dto/paginated-query.dto';

export class FindVehicleCatalogDto extends PaginatedQueryDto {
  // Por defecto el listado solo muestra catálogos activos (isActive=true);
  // pasar true incluye también los archivados, para poder reactivarlos.
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}
