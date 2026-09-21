import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateTicketCommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body: string;

  // Solo puede ponerse en true si el usuario tiene el permiso tickets:update
  // (validado en el service) — el usuario que reporta el ticket nunca puede
  // crear una nota interna.
  @IsOptional()
  @IsBoolean()
  isInternal?: boolean;
}
