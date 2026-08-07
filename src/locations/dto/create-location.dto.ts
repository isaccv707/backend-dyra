import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CreateLocationDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsUUID()
  @IsNotEmpty()
  branchId!: string;
}
