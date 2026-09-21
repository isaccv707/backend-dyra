import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Category } from '@prisma/client';

export class CreateTicketSubcategoryDto {
  @IsEnum(Category)
  category: Category;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}
