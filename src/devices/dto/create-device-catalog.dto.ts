import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
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

  // Archivado en vez de borrado: false lo oculta del listado por defecto
  // (GET /device-catalog) sin afectar los DeviceItem que ya lo referencian.
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
