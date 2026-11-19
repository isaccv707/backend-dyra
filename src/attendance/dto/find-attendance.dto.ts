import {
  AttendanceSource,
  AttendanceStatus,
  AttendanceType,
} from '@prisma/client';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID, Matches } from 'class-validator';
import { PaginatedQueryDto } from 'src/common/dto/paginated-query.dto';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_ONLY_MESSAGE = 'La fecha debe tener el formato YYYY-MM-DD';

/** Rango de días calendario del laboratorio (America/Mexico_City). */
export class AttendanceRangeDto {
  /** Primer día (YYYY-MM-DD), incluido. */
  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_ONLY_MESSAGE })
  from?: string;

  /** Último día (YYYY-MM-DD), incluido. */
  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_ONLY_MESSAGE })
  to?: string;
}

export class AttendanceSummaryQueryDto extends AttendanceRangeDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;
}

export class FindAttendanceDto extends PaginatedQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_ONLY_MESSAGE })
  from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_ONLY_MESSAGE })
  to?: string;

  @IsOptional()
  @ApiPropertyOptional({ enum: AttendanceStatus, enumName: 'AttendanceStatus' })
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;

  @IsOptional()
  @ApiPropertyOptional({ enum: AttendanceType, enumName: 'AttendanceType' })
  @IsEnum(AttendanceType)
  type?: AttendanceType;

  @IsOptional()
  @ApiPropertyOptional({ enum: AttendanceSource, enumName: 'AttendanceSource' })
  @IsEnum(AttendanceSource)
  source?: AttendanceSource;
}

export class AttendanceUsersQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
