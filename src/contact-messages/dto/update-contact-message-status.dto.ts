import { ContactMessageStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateContactMessageStatusDto {
  @IsEnum(ContactMessageStatus, { message: 'Estatus inválido' })
  status: ContactMessageStatus;

  /** Internal follow-up note, e.g. "Se le llamó, agenda el lunes". */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(1000, { message: 'La nota no debe exceder 1000 caracteres' })
  note?: string;
}
