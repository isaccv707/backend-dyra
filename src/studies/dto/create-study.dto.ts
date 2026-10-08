import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
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
import { Transform, Type } from 'class-transformer';
import { STUDY_MAX_DECIMALS } from '../constants/study-fields.const';
import { EligiblePatientsDto } from './eligible-patients.dto';
import { CreateReferenceValueDto } from './reference-value.dto';

export class StudyPriceDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
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
  @IsNotEmpty()
  @MaxLength(200)
  @IsOptional()
  slug?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
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
  sampleTypeId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  sectionId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  techniqueId!: number;

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

  @IsOptional()
  @IsBoolean()
  isPanel?: boolean;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @IsOptional()
  units?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(STUDY_MAX_DECIMALS)
  @IsOptional()
  decimals?: number;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EligiblePatientsDto)
  eligiblePatients?: EligiblePatientsDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateReferenceValueDto)
  referenceValues?: CreateReferenceValueDto[];
}
