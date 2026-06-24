import { IsString, IsOptional } from 'class-validator';

export class CreatePermissionDto {
  @IsString()
  action!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
