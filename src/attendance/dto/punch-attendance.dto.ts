import { ApiProperty } from '@nestjs/swagger';
import { AttendanceType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class PunchAttendanceDto {
  /** CHECK_IN (entrada) o CHECK_OUT (salida). */
  @ApiProperty({ enum: AttendanceType, enumName: 'AttendanceType' })
  @IsEnum(AttendanceType)
  type!: AttendanceType;

  /** Sucursal donde se checa; debe pertenecer al usuario. */
  @IsUUID()
  branchId!: string;

  /** Latitud reportada por el navegador (Geolocation API). */
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  /** Longitud reportada por el navegador (Geolocation API). */
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  /** Precisión de la lectura en metros (`coords.accuracy`). */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100_000)
  accuracyM!: number;

  /** Hora del dispositivo (ISO 8601). Solo para detectar relojes desfasados. */
  @IsOptional()
  @IsDateString()
  clientTimestamp?: string;

  /** Comentario opcional (p. ej. motivo de checar fuera de la sucursal). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
