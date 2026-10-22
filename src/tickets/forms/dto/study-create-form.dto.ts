import { ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { CreateStudyDto } from 'src/studies/dto/create-study.dto';

export const MAX_PANEL_ITEMS = 300;

/**
 * Fields IT captures when approving (code, title, abbreviation, slug) and the
 * ones fixed by the ticket (branchId) are not requested.
 */
const NOT_REQUESTED = [
  'code',
  'title',
  'abbreviation',
  'slug',
  'branchId',
  'isActive',
] as const;

/** A new parameter requested inside a panel: never a panel itself. */
export class StudyFormChildDto extends OmitType(CreateStudyDto, [
  ...NOT_REQUESTED,
  'isPanel',
] as const) {}

/** Exactly one of `studyId` (existing study) or `newStudy`. */
export class StudyFormPanelItemDto {
  @IsOptional()
  @IsUUID()
  studyId?: string;

  @ApiPropertyOptional({ type: () => StudyFormChildDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => StudyFormChildDto)
  newStudy?: StudyFormChildDto;
}

export class StudyCreateFormDto extends OmitType(
  CreateStudyDto,
  NOT_REQUESTED,
) {
  /** Hijos del perfil en orden (solo si isPanel). */
  @ApiPropertyOptional({ type: () => [StudyFormPanelItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PANEL_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => StudyFormPanelItemDto)
  panelItems?: StudyFormPanelItemDto[];
}
