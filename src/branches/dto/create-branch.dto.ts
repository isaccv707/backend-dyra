import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CreateAddressDto } from './create-address.dto';
import { CreateBranchScheduleDto } from './create-branch-schedule.dto';

export class CreateBranchDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsUrl()
  @IsString()
  urlResults!: string;

  @IsBoolean()
  @IsOptional()
  isVisible?: boolean;

  @IsInt()
  @IsNotEmpty()
  stateId!: number;

  @ValidateNested()
  @Type(() => CreateAddressDto)
  @IsNotEmpty()
  address!: CreateAddressDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateBranchScheduleDto)
  schedules?: CreateBranchScheduleDto[];

  /** Centro de la geocerca de asistencia; `null` la desactiva. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsLatitude()
  latitude?: number | null;

  /** Centro de la geocerca de asistencia; `null` la desactiva. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsLongitude()
  longitude?: number | null;

  /** Radio de la geocerca en metros (por defecto 150). */
  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(5000)
  geofenceRadiusM?: number;
}
