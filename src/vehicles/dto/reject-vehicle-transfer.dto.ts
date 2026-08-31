import { IsOptional, IsString } from 'class-validator';

export class RejectVehicleTransferDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
