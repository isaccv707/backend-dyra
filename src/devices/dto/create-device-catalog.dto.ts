import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { DeviceType } from '@prisma/client';

export class CreateDeviceCatalogDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(DeviceType)
  type!: DeviceType;

  @IsString()
  @IsNotEmpty()
  brand!: string;

  @IsString()
  @IsNotEmpty()
  model!: string;
}
