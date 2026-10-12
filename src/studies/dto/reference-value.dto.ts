import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  REFERENCE_VALUE_AGE_UNITS,
  REFERENCE_VALUE_GENDERS,
  STUDY_MAX_DECIMALS,
  type ReferenceValueAgeUnit,
  type ReferenceValueGender,
} from '../constants/study-fields.const';

export class CreateReferenceValueDto {
  @IsOptional()
  @IsIn(REFERENCE_VALUE_GENDERS, {
    message: `gender debe ser uno de: ${REFERENCE_VALUE_GENDERS.join(', ')}`,
  })
  gender?: ReferenceValueGender;

  @IsOptional()
  @IsIn(REFERENCE_VALUE_AGE_UNITS, {
    message: `unitAge debe ser uno de: ${REFERENCE_VALUE_AGE_UNITS.join(', ')}`,
  })
  unitAge?: ReferenceValueAgeUnit;

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
  @IsNumber({ maxDecimalPlaces: STUDY_MAX_DECIMALS })
  @IsOptional()
  minValue?: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: STUDY_MAX_DECIMALS })
  @IsOptional()
  maxValue?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @IsOptional()
  text?: string;

  @IsDateString()
  @IsOptional()
  date?: string;
}
