import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { STUDY_CATALOG_NAME_MAX_LENGTH } from '../study-catalog.config';

export class CreateStudyCatalogDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(STUDY_CATALOG_NAME_MAX_LENGTH)
  name!: string;

  @IsString()
  @IsUUID()
  @IsNotEmpty()
  branchId!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
