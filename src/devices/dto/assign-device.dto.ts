import { IsArray, IsDateString, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { SafeguardUsageType } from '@prisma/client';

// Exactamente uno de los dos debe llegar; la exclusividad (nunca ambos, y
// nunca ninguno) se valida en DevicesService, no alcanza con el DTO.
//
// usageType/startDate/endDate/mobileAccessories solo aplican cuando
// employeeId apunta a un equipo COMPUTER/MOBILE — marca/modelo/serie/
// condición/observaciones NO se piden aquí: se leen del propio DeviceItem
// (ya viven en inventario, capturados al darlo de alta).
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

  // Solo móvil: accesorios sin identificador propio (p.ej. "Cargador"). Si
  // se omite, se hereda del resguardo anterior de ese mismo celular.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mobileAccessories?: string[];
}
