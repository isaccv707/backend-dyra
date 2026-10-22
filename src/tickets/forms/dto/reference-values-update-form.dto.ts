import { ApiProperty, PickType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { CreateReferenceValueDto } from 'src/studies/dto/reference-value.dto';
import { StudyUpdateFormDto } from './study-update-form.dto';

/**
 * Only the reference values of a parameter: a STUDY_UPDATE limited to that
 * list, so it shares its validation, base version and apply.
 */
export class ReferenceValuesUpdateFormDto extends PickType(StudyUpdateFormDto, [
  'studyId',
  'baseVersions',
] as const) {
  /** Reemplaza todos los valores de referencia del parámetro ([] los quita). */
  @ApiProperty({ type: () => [CreateReferenceValueDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateReferenceValueDto)
  referenceValues!: CreateReferenceValueDto[];
}

/** TI no captura nada al aprobar: se aplica la lista solicitada. */
export class ApplyReferenceValuesUpdateFormDto {}
