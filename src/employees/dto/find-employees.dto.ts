import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginatedQueryDto } from 'src/common/dto/paginated-query.dto';

export class FindEmployeesDto extends PaginatedQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsString()
  department?: string;

  // Por defecto el listado solo muestra empleados activos (isActive=true);
  // pasar true incluye también a los dados de baja (offboard).
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}
