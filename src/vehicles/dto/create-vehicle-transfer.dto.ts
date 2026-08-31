import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class VehicleTransferItemDto {
  @IsString()
  @IsUUID()
  @IsNotEmpty()
  vehicleId!: string;
}

export class CreateVehicleTransferDto {
  @IsString()
  @IsUUID()
  @IsNotEmpty()
  originBranchId!: string;

  @IsString()
  @IsUUID()
  @IsNotEmpty()
  destinationBranchId!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique((item: VehicleTransferItemDto) => item.vehicleId)
  @ValidateNested({ each: true })
  @Type(() => VehicleTransferItemDto)
  items!: VehicleTransferItemDto[];
}
