import { ApiPropertyOptional } from '@nestjs/swagger';
import { ContactMessageSubject } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Public contact form of the site (/contact). */
export class CreateContactMessageDto {
  @IsUUID()
  branchId: string;

  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  @MaxLength(100, { message: 'El nombre no debe exceder 100 caracteres' })
  name: string;

  @Transform(trim)
  @IsEmail({}, { message: 'Correo inválido' })
  @MaxLength(254)
  email: string;

  /** Any format ("33 1234 5678", "(33) 1234-5678"); only digits are stored. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/\D/g, '') : value,
  )
  @IsString()
  @Matches(/^\d{8,15}$/, {
    message: 'El teléfono debe tener entre 8 y 15 dígitos',
  })
  phone: string;

  @IsEnum(ContactMessageSubject, { message: 'Asunto inválido' })
  subject: ContactMessageSubject;

  @Transform(trim)
  @IsString()
  @MinLength(10, { message: 'El mensaje debe tener al menos 10 caracteres' })
  @MaxLength(2000, { message: 'El mensaje no debe exceder 2000 caracteres' })
  message: string;

  @IsBoolean()
  @Equals(true, { message: 'Debes aceptar el aviso de privacidad' })
  privacyAccepted: boolean;

  /**
   * Honeypot: hidden in the form, so people leave it empty. When a bot fills
   * it the request "succeeds" but nothing is stored nor emailed.
   */
  @ApiPropertyOptional({ description: 'Honeypot anti-spam: debe ir vacío.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}

export class ContactMessageReceivedDto {
  received!: boolean;

  /** Folio to show the patient; absent when the honeypot caught a bot. */
  folio?: number;
}
