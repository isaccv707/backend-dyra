import { ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Category, TicketPriority } from '@prisma/client';
import { TICKET_FORM_DTOS } from '../forms/ticket-form-dtos';

export class CreateTicketDto {
  @IsUUID()
  branchId: string;

  /** Requerido salvo en formularios que generan el título (Accesos, CogniTI). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  /** Requerido salvo en formularios que generan el título (Accesos, CogniTI). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(3000, {
    message: 'description no debe exceder los 3000 caracteres',
  })
  description?: string;

  @IsEnum(Category)
  category: Category;

  /** Requerido en COGNITI: la subcategoría define el formulario. */
  @IsOptional()
  @IsUUID()
  subcategoryId?: string;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority = TicketPriority.MEDIUM;

  /**
   * Formulario de la categoría: SOFTWARE → SoftwareRemoteFormDto,
   * ACCESS → AccessRequestFormDto, COGNITI → según `subcategory.formType`.
   * Prohibido en categorías sin formulario.
   */
  @ApiPropertyOptional({
    oneOf: TICKET_FORM_DTOS.map((dto) => ({ $ref: getSchemaPath(dto) })),
  })
  @IsOptional()
  @IsObject()
  form?: Record<string, unknown>;
}
