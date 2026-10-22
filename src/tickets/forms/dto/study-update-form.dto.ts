import {
  ApiHideProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsUUID,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  CreateStudyDto,
  StudyPriceDto,
} from 'src/studies/dto/create-study.dto';
import {
  MAX_PANEL_ITEMS,
  StudyFormPanelItemDto,
} from './study-create-form.dto';

const isProvided = (_dto: object, value: unknown) => value !== undefined;

/**
 * Same fields as UpdateStudyDto (built from CreateStudyDto so Swagger sees
 * them). Only the fields sent change; lists (prices, references, children)
 * are replaced whole.
 */
export class StudyUpdateFormDto extends PartialType(
  OmitType(CreateStudyDto, [
    'code',
    'title',
    'abbreviation',
    'slug',
    'branchId',
    'isActive',
    'studyPrices',
    'sectionId',
    'sampleTypeId',
    'techniqueId',
  ] as const),
) {
  @IsUUID()
  studyId!: string;

  /**
   * Set by the server when the request is saved (whatever the client sends is
   * replaced): version of each list it replaces, checked again on approval.
   */
  @ApiHideProperty()
  @IsOptional()
  @IsObject()
  baseVersions?: Partial<
    Record<'studyPrices' | 'referenceValues' | 'panelItems', string>
  >;

  /** Section and sample type can change but not be cleared. */
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

  /** `null` quita la técnica. */
  @ApiPropertyOptional({ type: Number, nullable: true })
  @ValidateIf(
    (_dto: object, value: unknown) => value !== undefined && value !== null,
  )
  @Type(() => Number)
  @IsInt()
  @Min(1)
  techniqueId?: number | null;

  /** Reemplaza todos los precios: un tarifario que no venga pierde su precio. */
  @ApiPropertyOptional({ type: () => [StudyPriceDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StudyPriceDto)
  studyPrices?: StudyPriceDto[];

  /** Reemplaza los hijos del perfil. */
  @ApiPropertyOptional({ type: () => [StudyFormPanelItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PANEL_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => StudyFormPanelItemDto)
  panelItems?: StudyFormPanelItemDto[];
}
