import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { PaginatedQueryDto } from 'src/common/dto/paginated-query.dto';
import {
  STUDY_AGE_FORMATS,
  STUDY_GENDERS,
  type StudyAgeFormat,
  type StudyGender,
} from '../constants/study-fields.const';

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

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minAge?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxAge?: number;
}
