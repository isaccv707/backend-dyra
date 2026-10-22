import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class ClientCreateFormDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsEmail({}, { message: 'email debe ser un correo válido' })
  email!: string;

  /** Cliente con cuenta por cobrar (crédito). */
  @IsBoolean()
  receivable!: boolean;

  @IsBoolean()
  payInCash!: boolean;

  /** Tarifario activo de la sucursal del ticket. */
  @IsUUID()
  priceSheetId!: string;
}
