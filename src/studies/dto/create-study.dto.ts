import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsLowercase,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  STUDY_AGE_FORMATS,
  STUDY_GENDERS,
  STUDY_MAX_DECIMALS,
  type StudyAgeFormat,
  type StudyGender,
} from '../constants/study-fields.const';

export class StudyPriceDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  price!: number;

  @IsString()
  @IsUUID()
  @IsNotEmpty()
  priceSheetId!: string;

  @IsBoolean()
  @IsOptional()
  showPrice?: boolean = true;
}

export class CreateStudyDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(200)
  name!: string;

  @IsString()
  @IsOptional()
  @IsLowercase()
  slug?: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(20)
  code!: string;

  @IsString()
  @MaxLength(3000, {
    message: 'La descripción es demasiado larga (máximo 3000 caracteres).',
  })
  @IsOptional()
  description?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StudyPriceDto)
  studyPrices?: StudyPriceDto[];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  sampleTypeId?: number | null;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  sectionId?: number | null;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  techniqueId?: number | null;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @IsOptional()
  deliveryTime?: number;

  @IsString()
  @MaxLength(3000, {
    message: 'La preparación es demasiado larga (máximo 3000 caracteres).',
  })
  @IsOptional()
  preparation?: string;

  @IsNotEmpty()
  @IsString()
  @IsUUID()
  serviceId!: string;

  @IsNotEmpty()
  @IsString()
  @IsUUID()
  branchId!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  abbreviation?: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  title?: string;

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
  gender?: StudyGender;

  @IsOptional()
  @IsIn(STUDY_AGE_FORMATS, {
    message: `ageFormat debe ser uno de: ${STUDY_AGE_FORMATS.join(', ')}`,
  })
  ageFormat?: StudyAgeFormat;

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
}
