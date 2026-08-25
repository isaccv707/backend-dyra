import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsEnum, IsOptional, IsString, IsUUID, ValidateIf, ValidateNested } from 'class-validator';
import { ResguardoUsageType } from '@prisma/client';
import { ResguardoVehicleInspectionItemDto } from './resguardo-vehicle-inspection-item.dto';

// Marca/modelo/serie/placa/condición/observaciones NUNCA se capturan aquí:
// se leen en vivo de los DeviceItem ASSIGNED del empleado. Este endpoint
// solo sirve para (re)generar el documento; usageType/startDate/endDate son
// opcionales porque se heredan del resguardo más reciente del empleado si
// se omiten (solo obligatorios si es el primer resguardo que se le genera).
export class CreateResguardoDto {
  @IsString()
  @IsUUID()
  employeeId: string;

  @IsOptional()
  @IsEnum(ResguardoUsageType)
  usageType?: ResguardoUsageType;

  @ValidateIf((o) => o.usageType === ResguardoUsageType.TEMPORARY)
  @IsDateString({}, { message: 'startDate es obligatorio cuando usageType es TEMPORARY' })
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  // Solo vehículo: checklist del formato. Si se omite, se hereda del
  // resguardo anterior de ese mismo vehículo.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ResguardoVehicleInspectionItemDto)
  inspectionItems?: ResguardoVehicleInspectionItemDto[];

  // Solo móvil: accesorios sin identificador propio (p.ej. "Cargador"). Si
  // se omite, se hereda del resguardo anterior de ese mismo celular.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mobileAccessories?: string[];
}
