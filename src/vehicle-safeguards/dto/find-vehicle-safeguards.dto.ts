import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { PaginatedQueryDto } from 'src/common/dto/paginated-query.dto';

export class FindVehicleSafeguardsDto extends PaginatedQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  // Por defecto el listado solo muestra la versión vigente de cada resguardo
  // (supersededAt: null); pasar true incluye también las versiones históricas.
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeHistory?: boolean;
}
