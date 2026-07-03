import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreatePriceSheetDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
