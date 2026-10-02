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
} from 'class-validator';
import {
  OwnershipType,
  SafeguardConditionState,
  SafeguardUsageType,
} from '@prisma/client';
import { Transform } from 'class-transformer';

const NO_SERIAL_NUMBER_VALUES = new Set(['', 'N/A', 'NA', 'N.A.', 'S/N']);

const normalizeSerialNumber = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return NO_SERIAL_NUMBER_VALUES.has(trimmed.toUpperCase()) ? null : trimmed;
};

export class CreateDeviceItemDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\S(?:.*\S)?$/, {
    message:
      'internalCode no puede estar vacío ni empezar o terminar con espacios',
  })
  internalCode!: string;

  // Número de serie del equipo, para cualquier catalogId.type (incluido MOBILE).
  // Es opcional: vacío o "N/A" (en cualquier variante) se guarda como null,
  // que no choca con el @unique; en PATCH sirve para borrar el valor.
  @Transform(({ value }: { value: unknown }) => normalizeSerialNumber(value))
  @IsOptional()
  @IsString()
  serialNumber?: string | null;

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
  @ValidateIf(
    (o: CreateDeviceItemDto) => o.ownershipType === OwnershipType.PROVIDER,
  )
  @IsString()
  @IsNotEmpty({
    message: 'providerFolio es obligatorio cuando ownershipType es PROVIDER',
  })
  providerFolio?: string;

  // Estado físico del equipo (Nuevo/Seminuevo), obligatorio para cualquier
  // DeviceType. Se reutiliza tal cual al generar el resguardo del empleado
  // que lo tenga asignado — nunca se vuelve a pedir en assign().
  @IsEnum(SafeguardConditionState)
  condition!: SafeguardConditionState;

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

  // Solo aplican cuando catalogId.type = MOBILE; se valida en DevicesService.
  @IsOptional()
  @IsString()
  imei?: string;

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

  // Términos del resguardo que se genera automáticamente cuando el alta ya
  // trae employeeId para un equipo COMPUTER/MOBILE (misma regla que
  // POST /devices/:id/assign). No son datos del equipo: usageType/fechas
  // describen la asignación, mobileAccessories son accesorios sin
  // identificador propio capturados al momento de firmar.
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
  @IsString({ each: true })
  mobileAccessories?: string[];
}
