import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  STUDY_AGE_FORMATS,
  STUDY_GENDERS,
  STUDY_MAX_DECIMALS,
} from 'src/studies/constants/study-fields.const';
import { STUDY_CATALOG_NAME_MAX_LENGTH } from 'src/study-catalogs/study-catalog.config';

export class ImportStudyRowDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(20)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(200)
  name!: string;

  @IsString()
  @MaxLength(3000, {
    message: 'La descripción es demasiado larga (máximo 3000 caracteres).',
  })
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(STUDY_CATALOG_NAME_MAX_LENGTH)
  sampleType?: string;

  @IsString()
  @MaxLength(3000, {
    message: 'La preparación es demasiado larga (máximo 3000 caracteres).',
  })
  @IsOptional()
  preparation?: string;

  @IsString()
  @IsNotEmpty()
  serviceName!: string;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @IsOptional()
  deliveryTime?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsNumber({ maxDecimalPlaces: 2 })
  price!: number;

  @IsBoolean()
  @IsOptional()
  showPrice?: boolean = true;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  abbreviation?: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  title?: string;

  @IsString()
  @IsOptional()
  @MaxLength(STUDY_CATALOG_NAME_MAX_LENGTH)
  section?: string;

  @IsString()
  @IsOptional()
  @MaxLength(STUDY_CATALOG_NAME_MAX_LENGTH)
  technique?: string;

  @IsOptional()
  @IsBoolean()
  isPanel?: boolean;

  @IsOptional()
  @IsBoolean()
  isOrderable?: boolean;

  @IsOptional()
  @IsIn(STUDY_GENDERS, {
    message: `gender debe ser uno de: ${STUDY_GENDERS.join(', ')}`,
  })
  gender?: string;

  @IsOptional()
  @IsIn(STUDY_AGE_FORMATS, {
    message: `ageFormat debe ser uno de: ${STUDY_AGE_FORMATS.join(', ')}`,
  })
  ageFormat?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  minAge?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  maxAge?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(STUDY_MAX_DECIMALS)
  @IsOptional()
  decimals?: number;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  units?: string;
}
