import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateEmployeeDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  position?: string;

  @IsString()
  @IsNotEmpty()
  department!: string;

  @IsString()
  @IsUUID()
  @IsNotEmpty()
  branchId!: string;

  @IsOptional()
  @IsBoolean()
  hasSignedResponsibility?: boolean;
}
