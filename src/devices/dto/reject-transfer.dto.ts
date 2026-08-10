import { IsOptional, IsString } from 'class-validator';

export class RejectTransferDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
