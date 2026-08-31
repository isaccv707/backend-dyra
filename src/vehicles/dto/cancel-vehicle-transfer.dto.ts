import { IsOptional, IsString } from 'class-validator';

export class CancelVehicleTransferDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
