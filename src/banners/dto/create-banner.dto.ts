import { BannerPlacement } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Min,
  ValidateIf,
} from 'class-validator';

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

  @IsUUID()
  branchId!: string;
}
