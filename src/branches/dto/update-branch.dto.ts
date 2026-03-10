import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateBranchDto } from './create-branch.dto';
import { ValidateNested, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { UpdateAddressDto } from './update-address.dto';

export class UpdateBranchDto extends PartialType(OmitType(CreateBranchDto, ['address'] as const)) {
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateAddressDto)
  address?: UpdateAddressDto;
}
