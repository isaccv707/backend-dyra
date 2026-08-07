import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateIf,
} from 'class-validator';
import { DeviceCondition, OwnershipType } from '@prisma/client';

export class CreateDeviceItemDto {
  @IsString()
  @Matches(/^DYRA0000\d{4}$/, {
    message: 'internalCode debe tener el formato DYRA0000 seguido de 4 dígitos (ej. DYRA00000001)',
  })
  internalCode!: string;

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

  @IsOptional()
  @IsEnum(DeviceCondition)
  condition?: DeviceCondition;

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
}
