import { IsOptional, IsString, MaxLength } from 'class-validator';

export class FindAssignableUsersDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
