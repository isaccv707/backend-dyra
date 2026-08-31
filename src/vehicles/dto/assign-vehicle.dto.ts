import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsEnum, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { SafeguardUsageType } from '@prisma/client';
import { VehicleSafeguardInspectionItemDto } from 'src/vehicle-safeguards/dto/vehicle-safeguard-inspection-item.dto';

// Exactamente uno de los dos debe llegar; la exclusividad (nunca ambos, y
// nunca ninguno) se valida en VehiclesService, no alcanza con el DTO.
export class AssignVehicleDto {
  @IsOptional()
  @IsString()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsString()
  @IsUUID()
  locationId?: string;

  // Obligatorio salvo que el empleado ya tenga un resguardo previo del que
  // heredarlo (ver VehicleSafeguardsService.createFromEmployeeVehicle).
  @IsOptional()
  @IsEnum(SafeguardUsageType)
  usageType?: SafeguardUsageType;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  // Checklist del formato. Si se omite, se hereda del resguardo anterior de
  // ese mismo vehículo.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VehicleSafeguardInspectionItemDto)
  inspectionItems?: VehicleSafeguardInspectionItemDto[];
}
