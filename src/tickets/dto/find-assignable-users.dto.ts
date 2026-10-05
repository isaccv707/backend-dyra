import { IsOptional, IsString, MaxLength } from 'class-validator';

export class FindAssignableUsersDto {
  // Filtra por nombre o email (contiene, sin distinguir mayúsculas).
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
