import { OmitType, PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, Max, Min, ValidateIf } from 'class-validator';
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

  /**
   * Position in the site's "Más solicitados" home section (1 = first).
   * `null` removes the study from the section.
   */
  @ValidateIf(
    (_dto: object, value: unknown) => value !== undefined && value !== null,
  )
  @Type(() => Number)
  @IsInt({ message: 'featuredOrder debe ser un número entero.' })
  @Min(1, { message: 'featuredOrder debe ser mayor o igual a 1.' })
  @Max(99, { message: 'featuredOrder debe ser menor o igual a 99.' })
  featuredOrder?: number | null;
}
