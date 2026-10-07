import { IsIn, IsOptional, IsString } from 'class-validator';
import { VEHICLE_INSPECTION_ITEM_KEYS } from '../constants/vehicle-inspection-items.const';

export class VehicleSafeguardInspectionItemDto {
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
