import { IsOptional, IsString } from 'class-validator';

export class RetireDeviceDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
