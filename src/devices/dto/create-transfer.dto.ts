import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class TransferItemDto {
  @IsString()
  @IsUUID()
  @IsNotEmpty()
  deviceId!: string;
}

export class CreateTransferDto {
  @IsString()
  @IsUUID()
  @IsNotEmpty()
  originBranchId!: string;

  @IsString()
  @IsUUID()
  @IsNotEmpty()
  destinationBranchId!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique((item: TransferItemDto) => item.deviceId)
  @ValidateNested({ each: true })
  @Type(() => TransferItemDto)
  items!: TransferItemDto[];
}
