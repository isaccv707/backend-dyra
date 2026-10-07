import { OmitType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { MAX_PANEL_ITEMS } from './study-create-form.dto';

export class ApplyStudyCreateFormDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  code!: string;

  @IsUUID()
  serviceId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  abbreviation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  description?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  deliveryTime?: number;

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  preparation?: string;

  @IsOptional()
  @IsBoolean()
  isOrderable?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PANEL_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => ApplyNewPanelChildDto)
  newStudies?: ApplyNewPanelChildDto[];
}

export class ApplyNewPanelChildDto extends OmitType(ApplyStudyCreateFormDto, [
  'serviceId',
  'isOrderable',
  'newStudies',
] as const) {
  @IsOptional()
  @IsUUID()
  serviceId?: string;
}
