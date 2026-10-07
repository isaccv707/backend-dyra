import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Category, TicketFormType } from '@prisma/client';

export class CreateTicketSubcategoryDto {
  @IsEnum(Category)
  category: Category;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsEnum(TicketFormType)
  formType?: TicketFormType | null;
}
