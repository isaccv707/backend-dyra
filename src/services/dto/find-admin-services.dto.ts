import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { PaginatedQueryDto } from 'src/common/dto/paginated-query.dto';
import { toBoolean } from './find-services.dto';

export class FindAdminServicesDto extends PaginatedQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  /** Omitido = activos e inactivos. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;
}

export class FindAdminServiceStudiesDto extends PaginatedQueryDto {
  /** true = solo perfiles (paneles), false = solo estudios individuales. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isPanel?: boolean;

  /** Omitido = activos e inactivos. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;
}
