import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OwnershipType, SafeguardConditionState, SafeguardUsageType } from '@prisma/client';
import { VehicleSafeguardInspectionItemDto } from 'src/vehicle-safeguards/dto/vehicle-safeguard-inspection-item.dto';

export class CreateVehicleItemDto {
  @IsString()
  @Matches(/^DYRA\d{8}$/, {
    message: 'internalCode debe tener el formato DYRA seguido de 8 dígitos (ej. DYRA12345678)',
  })
  internalCode!: string;

  @IsOptional()
  @IsString()
  plateNumber?: string;

  @IsOptional()
  @IsString()
  mileage?: string;

  @IsOptional()
  @IsString()
  fuelType?: string;

  @IsOptional()
  @IsString()
  transmission?: string;

  @IsString()
  @IsUUID()
  @IsNotEmpty()
  catalogId!: string;

  @IsString()
  @IsUUID()
  @IsNotEmpty()
  currentBranchId!: string;

  @IsOptional()
  @IsEnum(OwnershipType)
  ownershipType?: OwnershipType;

  @ValidateIf((o: CreateVehicleItemDto) => o.ownershipType === OwnershipType.PROVIDER)
  @IsString()
  @IsNotEmpty({ message: 'providerFolio es obligatorio cuando ownershipType es PROVIDER' })
  providerFolio?: string;

  // Estado físico del vehículo (Nuevo/Seminuevo), obligatorio. Se reutiliza
  // tal cual al generar el resguardo del empleado que lo tenga asignado —
  // nunca se vuelve a pedir en assign().
  @IsEnum(SafeguardConditionState)
  condition!: SafeguardConditionState;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsString()
  @IsUUID()
  locationId?: string;

  // Términos del resguardo que se genera automáticamente cuando el alta ya
  // trae employeeId (misma regla que POST /vehicles/:id/assign). No son
  // datos del vehículo: usageType/fechas describen la asignación,
  // inspectionItems es el checklist capturado al momento de firmar.
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
