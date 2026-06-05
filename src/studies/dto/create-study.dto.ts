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

class StudyPriceDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
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
  @MaxLength(500)
  @IsOptional()
  description?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StudyPriceDto)
  @IsNotEmpty()
  studyPrices!: StudyPriceDto[];

  @IsString()
  @IsOptional()
  @MaxLength(100)
  sampleType?: string;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @IsOptional()
  deliveryTime?: number;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  preparation?: string;

  @IsNotEmpty()
  @IsString()
  serviceId!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
