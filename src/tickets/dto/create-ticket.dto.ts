import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Category, TicketPriority } from '@prisma/client';

export class CreateTicketDto {
  @IsUUID()
  branchId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(3000, {
    message: 'description no debe exceder los 3000 caracteres',
  })
  description: string;

  @IsEnum(Category)
  category: Category;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority = TicketPriority.MEDIUM;
}
