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
import { OwnershipType, ResguardoConditionState, ResguardoUsageType } from '@prisma/client';
import { VehicleDetailDto } from './vehicle-detail.dto';
import { ResguardoVehicleInspectionItemDto } from 'src/resguardos/dto/resguardo-vehicle-inspection-item.dto';

export class CreateDeviceItemDto {
  @IsString()
  @Matches(/^DYRA\d{8}$/, {
    message: 'internalCode debe tener el formato DYRA seguido de 8 dígitos (ej. DYRA12345678)',
  })
  internalCode!: string;

  // Serie del equipo (COMPUTER) o IMEI (MOBILE) — mismo campo, según catalogId.type.
  @IsOptional()
  @IsString()
  serialNumber?: string;

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

  // The callback receives the DTO instance being validated (conventionally
  // named `o`), not the value of this property. When it returns false the
  // property is skipped entirely, so no @IsOptional is needed alongside it.
  @ValidateIf((o: CreateDeviceItemDto) => o.ownershipType === OwnershipType.PROVIDER)
  @IsString()
  @IsNotEmpty({ message: 'providerFolio es obligatorio cuando ownershipType es PROVIDER' })
  providerFolio?: string;

  // Estado físico del equipo (Nuevo/Seminuevo), obligatorio para cualquier
  // DeviceType. Se reutiliza tal cual al generar el resguardo del empleado
  // que lo tenga asignado — nunca se vuelve a pedir en assign().
  @IsEnum(ResguardoConditionState)
  condition!: ResguardoConditionState;

  // Observaciones del equipo (inventario). Mismo texto que aparece como
  // "Observaciones" en el resguardo generado.
  @IsOptional()
  @IsString()
  notes?: string;

  // Solo aplica cuando catalogId.type = COMPUTER; se valida en DevicesService.
  @IsOptional()
  @IsString()
  hardDrive?: string;

  @IsOptional()
  @IsString()
  processor?: string;

  // Solo aplica cuando catalogId.type = MOBILE; se valida en DevicesService.
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  // employeeId/locationId NO aplican cuando catalogId.type es MONITOR/
  // KEYBOARD/MOUSE (esos se enlazan vía mainDeviceId, no directamente a un
  // empleado/ubicación) — validado en DevicesService.
  @IsOptional()
  @IsString()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsString()
  @IsUUID()
  locationId?: string;

  // Solo aplica cuando catalogId.type es MONITOR/KEYBOARD/MOUSE: id de la
  // DeviceItem tipo COMPUTER a la que este accesorio queda enlazado.
  // employeeId/locationId/status/currentBranchId del accesorio se derivan
  // de esa computadora en ese momento y se mantienen en cascada mientras
  // dure el enlace (ver DevicesService).
  @IsOptional()
  @IsString()
  @IsUUID()
  mainDeviceId?: string;

  // Solo aplica cuando el DeviceCatalog referenciado por catalogId es de tipo
  // VEHICLE; la correspondencia se valida en DevicesService, no aquí (el DTO
  // no conoce el type del catálogo sin consultarlo).
  @IsOptional()
  @ValidateNested()
  @Type(() => VehicleDetailDto)
  vehicleDetail?: VehicleDetailDto;

  // Términos del resguardo que se genera automáticamente cuando el alta ya
  // trae employeeId para un equipo COMPUTER/MOBILE/VEHICLE (misma regla que
  // POST /devices/:id/assign). No son datos del equipo: usageType/fechas
  // describen la asignación, inspectionItems/mobileAccessories son checklist
  // y accesorios sin identificador propio capturados al momento de firmar.
  @IsOptional()
  @IsEnum(ResguardoUsageType)
  usageType?: ResguardoUsageType;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ResguardoVehicleInspectionItemDto)
  inspectionItems?: ResguardoVehicleInspectionItemDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mobileAccessories?: string[];
}
