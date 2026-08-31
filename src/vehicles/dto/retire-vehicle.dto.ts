import { IsOptional, IsString } from 'class-validator';

export class RetireVehicleDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
