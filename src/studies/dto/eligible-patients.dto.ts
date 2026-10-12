import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import {
  STUDY_AGE_FORMATS,
  STUDY_GENDERS,
  type StudyAgeFormat,
  type StudyGender,
} from '../constants/study-fields.const';

export class EligiblePatientsDto {
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
}
