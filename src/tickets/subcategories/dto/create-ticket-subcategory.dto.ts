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

  /** Formulario que pide la subcategoría (solo COGNITI: STUDY_CREATE, STUDY_UPDATE, CLIENT_CREATE, REFERENCE_VALUES_UPDATE). */
  @IsOptional()
  @IsEnum(TicketFormType)
  formType?: TicketFormType | null;
}
