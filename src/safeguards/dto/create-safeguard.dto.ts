import { IsArray, IsDateString, IsEnum, IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';
import { SafeguardUsageType } from '@prisma/client';

// Marca/modelo/serie/condición/observaciones NUNCA se capturan aquí: se leen
// en vivo de los DeviceItem ASSIGNED del empleado. Este endpoint solo sirve
// para (re)generar el documento; usageType/startDate/endDate son opcionales
// porque se heredan del resguardo más reciente del empleado si se omiten
// (solo obligatorios si es el primer resguardo que se le genera).
export class CreateSafeguardDto {
  @IsString()
  @IsUUID()
  employeeId: string;

  @IsOptional()
  @IsEnum(SafeguardUsageType)
  usageType?: SafeguardUsageType;

  @ValidateIf((o) => o.usageType === SafeguardUsageType.TEMPORARY)
  @IsDateString({}, { message: 'startDate es obligatorio cuando usageType es TEMPORARY' })
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
