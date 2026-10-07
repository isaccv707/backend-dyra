import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { SafeguardUsageType } from '@prisma/client';
import { VehicleSafeguardInspectionItemDto } from './vehicle-safeguard-inspection-item.dto';

export class CreateVehicleSafeguardDto {
  @IsString()
  @IsUUID()
  employeeId: string;

  @IsOptional()
  @IsEnum(SafeguardUsageType)
  usageType?: SafeguardUsageType;

  @ValidateIf(
    (o: CreateVehicleSafeguardDto) =>
      o.usageType === SafeguardUsageType.TEMPORARY,
  )
  @IsDateString(
    {},
    { message: 'startDate es obligatorio cuando usageType es TEMPORARY' },
  )
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
