import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateVehicleCatalogDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  brand!: string;

  @IsString()
  @IsNotEmpty()
  model!: string;

  // Archivado en vez de borrado: false lo oculta del listado por defecto
  // (GET /vehicle-catalog) sin afectar los VehicleItem que ya lo referencian.
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
