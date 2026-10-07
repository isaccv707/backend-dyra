import { OmitType, PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import {
  StudyCreateFormDto,
  StudyCreateFormPriceDto,
} from '../study-create/study-create-form.dto';

export class StudyUpdateFormDto extends PartialType(
  OmitType(StudyCreateFormDto, ['prices', 'panelItems'] as const),
) {
  @IsUUID()
  studyId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StudyCreateFormPriceDto)
  prices?: StudyCreateFormPriceDto[];
}
