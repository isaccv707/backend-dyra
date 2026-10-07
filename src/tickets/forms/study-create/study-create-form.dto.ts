import { OmitType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  STUDY_AGE_FORMATS,
  STUDY_GENDERS,
  STUDY_MAX_DECIMALS,
  type StudyAgeFormat,
  type StudyGender,
} from 'src/studies/constants/study-fields.const';

export const MAX_PANEL_ITEMS = 300;

export class StudyCreateFormPriceDto {
  @IsUUID()
  priceSheetId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price!: number;
}

export class StudyCreateFormDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(200)
  name!: string;

  @IsInt()
  @Min(1)
  sectionId!: number;

  @IsInt()
  @Min(1)
  sampleTypeId!: number;

  @IsInt()
  @Min(1)
  techniqueId!: number;

  @IsBoolean()
  isPanel!: boolean;

  @IsIn(STUDY_GENDERS, {
    message: `gender debe ser uno de: ${STUDY_GENDERS.join(', ')}`,
  })
  gender!: StudyGender;

  @IsIn(STUDY_AGE_FORMATS, {
    message: `ageFormat debe ser uno de: ${STUDY_AGE_FORMATS.join(', ')}`,
  })
  ageFormat!: StudyAgeFormat;

  @IsInt()
  @Min(0)
  minAge!: number;

  @IsInt()
  @Min(0)
  maxAge!: number;

  @ValidateIf((form: { isPanel?: boolean }) => form.isPanel !== true)
  @IsInt()
  @Min(0)
  @Max(STUDY_MAX_DECIMALS)
  decimals?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  units?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StudyCreateFormPriceDto)
  prices!: StudyCreateFormPriceDto[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PANEL_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => StudyCreateFormPanelItemDto)
  panelItems?: StudyCreateFormPanelItemDto[];
}

export class StudyCreateFormChildDto extends OmitType(StudyCreateFormDto, [
  'isPanel',
  'prices',
  'panelItems',
] as const) {}

export class StudyCreateFormPanelItemDto {
  @IsOptional()
  @IsUUID()
  studyId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => StudyCreateFormChildDto)
  newStudy?: StudyCreateFormChildDto;
}
