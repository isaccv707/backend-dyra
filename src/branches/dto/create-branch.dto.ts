import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
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

  // Controla si la sucursal se muestra en el listado de la página web.
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
}
