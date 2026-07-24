import {
  IsArray,
  IsBoolean,
  IsInt,
  IsLowercase,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class StudyPriceDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  // @IsPositive()
  price!: number;

  @IsString()
  @IsUUID()
  @IsNotEmpty()
  priceSheetId!: string;

  @IsBoolean()
  @IsOptional()
  showPrice?: boolean = true;
}

export class CreateStudyDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(200)
  name!: string;

  @IsString()
  @IsOptional()
  @IsLowercase()
  slug?: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(20)
  code!: string;

  @IsString()
  @MaxLength(3000, {
    message: 'La descripción es demasiado larga (máximo 3000 caracteres).',
  })
  @IsOptional()
  description?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StudyPriceDto)
  studyPrices?: StudyPriceDto[];

  @IsString()
  @IsOptional()
  @MaxLength(500, {
    message: 'El tipo de muestra es demasiado largo (máximo 500 caracteres).',
  })
  sampleType?: string;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @IsOptional()
  deliveryTime?: number;

  @IsString()
  @MaxLength(3000, {
    message: 'La preparación es demasiado larga (máximo 3000 caracteres).',
  })
  @IsOptional()
  preparation?: string;

  @IsNotEmpty()
  @IsString()
  @IsUUID()
  serviceId!: string;

  @IsNotEmpty()
  @IsString()
  @IsUUID()
  branchId!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
