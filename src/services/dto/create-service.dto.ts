import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class BenefitDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  title!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  icon?: string;
}

export class ServiceDetailDto {
  @IsNotEmpty()
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  image?: string;
}

export class CreateServiceDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  // @IsNotEmpty()
  @IsOptional()
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsString()
  imageUrl!: string;

  @IsOptional()
  @IsOptional()
  mobileImageUrl?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BenefitDto)
  @IsOptional()
  benefits?: BenefitDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServiceDetailDto)
  @IsOptional()
  details?: ServiceDetailDto[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  branchIds?: string[];
}
