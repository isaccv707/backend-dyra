import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MAX_PANEL_ITEMS } from './study-create-form.dto';

/** Identity fields IT assigns to a study when approving. */
export class StudyIdentityDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  code!: string;

  /** Título visible; default `name`. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  abbreviation?: string;

  /** Default: se genera de `name`. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  slug?: string;
}

export class ApplyStudyCreateFormDto extends StudyIdentityDto {
  /** Uno por cada `panelItems[].newStudy` del formulario, en el mismo orden. */
  @ApiPropertyOptional({ type: () => [StudyIdentityDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PANEL_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => StudyIdentityDto)
  newStudies?: StudyIdentityDto[];
}

/** Optional adjustments IT may add when approving an update. */
export class ApplyStudyUpdateFormDto extends PartialType(
  OmitType(StudyIdentityDto, ['slug'] as const),
) {
  /** Uno por cada `panelItems[].newStudy` del formulario, en el mismo orden. */
  @ApiPropertyOptional({ type: () => [StudyIdentityDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PANEL_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => StudyIdentityDto)
  newStudies?: StudyIdentityDto[];
}
