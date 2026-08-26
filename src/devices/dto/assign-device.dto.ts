import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsEnum, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { SafeguardUsageType } from '@prisma/client';
import { SafeguardVehicleInspectionItemDto } from 'src/safeguards/dto/safeguard-vehicle-inspection-item.dto';

// Exactamente uno de los dos debe llegar; la exclusividad (nunca ambos, y
// nunca ninguno) se valida en DevicesService, no alcanza con el DTO.
//
// usageType/startDate/endDate/inspectionItems/mobileAccessories solo aplican
// cuando employeeId apunta a un equipo COMPUTER/MOBILE/VEHICLE — marca/
// modelo/serie/placa/condición/observaciones NO se piden aquí: se leen del
// propio DeviceItem (ya viven en inventario, capturados al darlo de alta).
export class AssignDeviceDto {
  @IsOptional()
  @IsString()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsString()
  @IsUUID()
  locationId?: string;

  // Obligatorio salvo que el empleado ya tenga un resguardo previo del que
  // heredarlo (ver SafeguardsService.createFromEmployeeDevices).
  @IsOptional()
  @IsEnum(SafeguardUsageType)
  usageType?: SafeguardUsageType;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  // Solo vehículo: checklist del formato. Si se omite, se hereda del
  // resguardo anterior de ese mismo vehículo.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SafeguardVehicleInspectionItemDto)
  inspectionItems?: SafeguardVehicleInspectionItemDto[];

  // Solo móvil: accesorios sin identificador propio (p.ej. "Cargador"). Si
  // se omite, se hereda del resguardo anterior de ese mismo celular.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mobileAccessories?: string[];
}
