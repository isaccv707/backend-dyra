import { IsOptional, IsUUID } from 'class-validator';

export class FindServicesDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
