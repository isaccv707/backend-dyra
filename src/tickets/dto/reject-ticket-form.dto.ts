import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RejectTicketFormDto {
  /** Motivo visible para quien reportó el ticket. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(5, { message: 'El motivo debe tener al menos 5 caracteres' })
  @MaxLength(1000, { message: 'El motivo no debe exceder los 1000 caracteres' })
  reason!: string;
}
