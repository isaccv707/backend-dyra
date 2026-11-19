import { ApiProperty } from '@nestjs/swagger';
import { AttendanceType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Checada registrada por un supervisor (olvido), sin ubicación. */
export class CreateManualAttendanceDto {
  @IsUUID()
  userId!: string;

  @IsUUID()
  branchId!: string;

  @ApiProperty({ enum: AttendanceType, enumName: 'AttendanceType' })
  @IsEnum(AttendanceType)
  type!: AttendanceType;

  /** Momento real de la entrada/salida (ISO 8601); no puede ser futuro. */
  @IsDateString()
  recordedAt!: string;

  /** Motivo obligatorio (queda en la auditoría). */
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

/**
 * Revisión de una checada. Con `recordedAt` corrige la hora (status ADJUSTED);
 * sin él solo la aprueba (status VALID).
 */
export class AdjustAttendanceDto {
  @IsOptional()
  @IsDateString()
  recordedAt?: string;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}
