import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { PaginatedQueryDto } from 'src/common/dto/paginated-query.dto';

const toBoolean = ({ value }: { value: unknown }) =>
  value === true || value === 'true'
    ? true
    : value === false || value === 'false'
      ? false
      : value;

export class PaginationDto extends PaginatedQueryDto {
  @IsOptional()
  @IsString()
  priceSheetId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isPanel?: boolean;

  // El catálogo público debe enviar isOrderable=true para ocultar los
  // parámetros que solo existen dentro de un perfil.
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isOrderable?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sectionId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sampleTypeId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  techniqueId?: number;
}
