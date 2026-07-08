import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
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

  @IsInt()
  @IsNotEmpty()
  stateId!: number;

  @ValidateNested()
  @Type(() => CreateAddressDto)
  @IsNotEmpty()
  address!: CreateAddressDto;

  @IsString()
  priceSheetId!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateBranchScheduleDto)
  schedules?: CreateBranchScheduleDto[];
}
