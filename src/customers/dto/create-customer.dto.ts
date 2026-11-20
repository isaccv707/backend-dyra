import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export const CUSTOMER_NAME_MAX_LENGTH = 150;
export const CUSTOMER_AMOUNT_MAX = 9_999_999_999.99;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const notNull = (_: unknown, value: unknown) => value !== null;

/**
 * Modalidad de pago excluyente: `accountsReceivable` (genera cuenta por cobrar)
 * o `liquidate` (liquida al instante). Si solo llega uno, el otro se infiere
 * como su contrario; si no llega ninguno, el cliente liquida.
 */
export class CreateCustomerDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(CUSTOMER_NAME_MAX_LENGTH)
  name!: string;

  @Transform(trimLower)
  @IsEmail({}, { message: 'El correo electrónico no es válido' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    required: false,
    description:
      'Genera cuenta por cobrar (CxC). Excluyente con liquidate: no pueden ser ambos true ni ambos false. Si solo se envía uno, el otro se infiere como su contrario.',
  })
  @IsOptional()
  @IsBoolean()
  accountsReceivable?: boolean;

  @ApiProperty({
    required: false,
    description:
      'Liquida al instante (no genera CxC). Excluyente con accountsReceivable.',
  })
  @IsOptional()
  @IsBoolean()
  liquidate?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    format: 'uuid',
    description:
      'Hoja de precios activa de la misma sucursal; null la desasocia.',
  })
  @IsOptional()
  @ValidateIf(notNull)
  @IsUUID()
  priceSheetId?: string | null;

  @ApiProperty({ required: false, nullable: true, type: Number, minimum: 0 })
  @IsOptional()
  @ValidateIf(notNull)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(CUSTOMER_AMOUNT_MAX)
  contractAmount?: number | null;

  @ApiProperty({ required: false, nullable: true, type: Number, minimum: 0 })
  @IsOptional()
  @ValidateIf(notNull)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(CUSTOMER_AMOUNT_MAX)
  patientAmount?: number | null;

  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    example: '2026-01-01',
    description: 'Inicio de vigencia (YYYY-MM-DD).',
  })
  @IsOptional()
  @ValidateIf(notNull)
  @Matches(DATE_ONLY, { message: 'startDate debe tener el formato YYYY-MM-DD' })
  @IsDateString({ strict: true })
  startDate?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    example: '2026-12-31',
    description: 'Fin de vigencia (YYYY-MM-DD), igual o posterior a startDate.',
  })
  @IsOptional()
  @ValidateIf(notNull)
  @Matches(DATE_ONLY, { message: 'endDate debe tener el formato YYYY-MM-DD' })
  @IsDateString({ strict: true })
  endDate?: string | null;

  @IsUUID()
  @IsNotEmpty()
  branchId!: string;
}
