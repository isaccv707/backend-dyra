import { IsIn, IsOptional, IsString } from 'class-validator';
import { VEHICLE_INSPECTION_ITEM_KEYS } from '../constants/vehicle-inspection-items.const';

// `section` no se acepta desde el cliente: el service la resuelve a partir
// del catálogo fijo en base a `itemKey`.
export class ResguardoVehicleInspectionItemDto {
  @IsString()
  @IsIn(VEHICLE_INSPECTION_ITEM_KEYS)
  itemKey: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  observations?: string;
}
