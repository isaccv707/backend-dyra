import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { SafeguardUsageType } from '@prisma/client';
import { VehicleSafeguardInspectionItemDto } from 'src/vehicle-safeguards/dto/vehicle-safeguard-inspection-item.dto';

export class AssignVehicleDto {
  @IsOptional()
  @IsString()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsString()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsEnum(SafeguardUsageType)
  usageType?: SafeguardUsageType;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VehicleSafeguardInspectionItemDto)
  inspectionItems?: VehicleSafeguardInspectionItemDto[];
}
