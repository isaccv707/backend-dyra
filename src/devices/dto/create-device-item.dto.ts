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

export class CreateDeviceItemDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\S(?:.*\S)?$/, {
    message:
      'internalCode no puede estar vacío ni empezar o terminar con espacios',
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

  @ValidateIf(
    (o: CreateDeviceItemDto) => o.ownershipType === OwnershipType.PROVIDER,
  )
  @IsString()
  @IsNotEmpty({
    message: 'providerFolio es obligatorio cuando ownershipType es PROVIDER',
  })
  providerFolio?: string;

  @IsEnum(SafeguardConditionState)
  condition!: SafeguardConditionState;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  hardDrive?: string;

  @IsOptional()
  @IsString()
  processor?: string;

  @IsOptional()
  @IsString()
  imei?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsString()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsString()
  @IsUUID()
  mainDeviceId?: string;

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
