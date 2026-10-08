import { OmitType, PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { IsInt, Min, ValidateIf } from 'class-validator';
import { CreateStudyDto } from './create-study.dto';

const isProvided = (_dto: object, value: unknown) => value !== undefined;

export class UpdateStudyDto extends PartialType(
  OmitType(CreateStudyDto, [
    'studyPrices',
    'branchId',
    'sectionId',
    'sampleTypeId',
    'techniqueId',
  ] as const),
) {
  @ValidateIf(isProvided)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sectionId?: number;

  @ValidateIf(isProvided)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sampleTypeId?: number;

  @ValidateIf(isProvided)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  techniqueId?: number;
}
