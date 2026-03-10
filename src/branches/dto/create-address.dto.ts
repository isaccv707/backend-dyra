import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateAddressDto {
  @IsString()
  @IsNotEmpty()
  zipCode: string;

  @IsString()
  @IsNotEmpty()
  extNumber: string;

  @IsString()
  @IsOptional()
  intNumber?: string;

  @IsString()
  @IsOptional()
  references?: string;

  @IsString()
  @IsNotEmpty()
  street: string;

  @IsString()
  @IsOptional()
  neighborhood?: string;

  @IsString()
  @IsNotEmpty()
  city: string;
}
