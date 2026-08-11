import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ImportStudyRowDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(20)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(200)
  name!: string;

  @IsString()
  @MaxLength(3000, {
    message: 'La descripción es demasiado larga (máximo 3000 caracteres).',
  })
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500, {
    message: 'El tipo de muestra es demasiado largo (máximo 500 caracteres).',
  })
  sampleType?: string;

  @IsString()
  @MaxLength(3000, {
    message: 'La preparación es demasiado larga (máximo 3000 caracteres).',
  })
  @IsOptional()
  preparation?: string;

  @IsString()
  @IsNotEmpty()
  serviceName!: string;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @IsOptional()
  deliveryTime?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsNumber({ maxDecimalPlaces: 2 })
  price!: number;

  @IsBoolean()
  @IsOptional()
  showPrice?: boolean = true;
}
