import { OmitType, PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, Min, ValidateIf } from 'class-validator';
import { CreateStudyDto } from './create-study.dto';

const isProvided = (_dto: object, value: unknown) => value !== undefined;

export class UpdateStudyDto extends PartialType(
  OmitType(CreateStudyDto, [
    'studyPrices',
    'branchId',
    'sectionId',
    'sampleTypeId',
    'techniqueId',
    'providerCost',
  ] as const),
) {
  /** `null` removes the provider cost. */
  @ValidateIf(
    (_dto: object, value: unknown) => value !== undefined && value !== null,
  )
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  providerCost?: number | null;

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

  /** `null` removes the technique (it's optional, unlike section and sample type). */
  @ValidateIf(
    (_dto: object, value: unknown) => value !== undefined && value !== null,
  )
  @Type(() => Number)
  @IsInt()
  @Min(1)
  techniqueId?: number | null;
}
