import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsEnum, IsOptional, IsString, IsUUID, ValidateIf, ValidateNested } from 'class-validator';
import { SafeguardUsageType } from '@prisma/client';
import { VehicleSafeguardInspectionItemDto } from './vehicle-safeguard-inspection-item.dto';

// Marca/modelo/placa/condición NUNCA se capturan aquí: se leen en vivo del
// VehicleItem ASSIGNED del empleado. Este endpoint solo sirve para
// (re)generar el documento; usageType/startDate/endDate/inspectionItems son
// opcionales porque se heredan del resguardo más reciente del empleado si se
// omiten (solo obligatorios si es el primer resguardo que se le genera).
export class CreateVehicleSafeguardDto {
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

  // Checklist del formato. Si se omite, se hereda del resguardo anterior de
  // ese mismo vehículo.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VehicleSafeguardInspectionItemDto)
  inspectionItems?: VehicleSafeguardInspectionItemDto[];
}
