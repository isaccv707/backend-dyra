import { BannerPlacement } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const isSet = (_dto: object, value: unknown) =>
  value !== undefined && value !== null;

export class CreateBannerDto {
  @IsOptional()
  @IsEnum(BannerPlacement)
  placement: BannerPlacement;

  @IsUrl()
  imageUrl: string;

  @IsOptional()
  @IsString()
  mobileImageUrl: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** ISO 8601. `null` clears the start of the validity window. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsDateString()
  startAt?: string | null;

  /** ISO 8601. `null` removes the expiry (banner never expires). */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsDateString()
  endAt?: string | null;

  /** Visible headline (e.g. "Perfil tiroideo"). `null` clears it. */
  @IsOptional()
  @ValidateIf(isSet)
  @IsString()
  @MaxLength(80, { message: 'El título admite máximo 80 caracteres.' })
  title?: string | null;

  /** Short supporting text (e.g. "T3, T4 y TSH · resultados el mismo día"). */
  @IsOptional()
  @ValidateIf(isSet)
  @IsString()
  @MaxLength(200, { message: 'La descripción admite máximo 200 caracteres.' })
  description?: string | null;

  /** Accessible description of the image; the site falls back to `title`. */
  @IsOptional()
  @ValidateIf(isSet)
  @IsString()
  @MaxLength(200, {
    message: 'El texto alternativo admite máximo 200 caracteres.',
  })
  altText?: string | null;

  /** Internal path (`/study/perfil-tiroideo`) or absolute http(s) URL. */
  @IsOptional()
  @ValidateIf(isSet)
  @IsString()
  @Matches(/^(\/(?!\/)|https?:\/\/)/, {
    message:
      'El enlace debe ser una ruta del sitio (empieza con /) o una URL http(s).',
  })
  @MaxLength(500)
  linkUrl?: string | null;

  /** Button text; the site defaults to "Ver detalles". */
  @IsOptional()
  @ValidateIf(isSet)
  @IsString()
  @MaxLength(40, { message: 'El texto del botón admite máximo 40 caracteres.' })
  ctaLabel?: string | null;

  /** Promotional price (MXN, VAT included). */
  @IsOptional()
  @ValidateIf(isSet)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  promoPrice?: number | null;

  /** Regular price shown struck through next to promoPrice. */
  @IsOptional()
  @ValidateIf(isSet)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  regularPrice?: number | null;

  @IsUUID()
  branchId!: string;
}
