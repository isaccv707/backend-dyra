import {
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { SafeguardUsageType } from '@prisma/client';

export class CreateSafeguardDto {
  @IsString()
  @IsUUID()
  employeeId: string;

  @IsOptional()
  @IsEnum(SafeguardUsageType)
  usageType?: SafeguardUsageType;

  @ValidateIf(
    (o: CreateSafeguardDto) => o.usageType === SafeguardUsageType.TEMPORARY,
  )
  @IsDateString(
    {},
    { message: 'startDate es obligatorio cuando usageType es TEMPORARY' },
  )
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mobileAccessories?: string[];
}
