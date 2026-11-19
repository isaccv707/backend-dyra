import { ApiProperty } from '@nestjs/swagger';
import {
  AttendanceFlag,
  AttendanceSource,
  AttendanceStatus,
  AttendanceType,
} from '@prisma/client';

/**
 * Response shapes of the attendance API, for OpenAPI only: the services return
 * Prisma objects with this shape (ATTENDANCE_RECORD_INCLUDE in
 * attendance.shared.ts). Keep both in sync.
 */

export class AttendanceRefDto {
  id!: string;
  name!: string;
}

export class AttendanceRecordDto {
  id!: string;
  @ApiProperty({ enum: AttendanceType, enumName: 'AttendanceType' })
  type!: AttendanceType;
  @ApiProperty({ enum: AttendanceStatus, enumName: 'AttendanceStatus' })
  status!: AttendanceStatus;
  @ApiProperty({ enum: AttendanceSource, enumName: 'AttendanceSource' })
  source!: AttendanceSource;
  recordedAt!: Date;
  clientTimestamp!: Date | null;
  /** null en checadas manuales. */
  latitude!: number | null;
  longitude!: number | null;
  accuracyM!: number | null;
  /** Distancia al centro de la sucursal; null si la sucursal no tiene coordenadas. */
  distanceM!: number | null;
  withinGeofence!: boolean | null;
  @ApiProperty({
    enum: AttendanceFlag,
    enumName: 'AttendanceFlag',
    isArray: true,
  })
  flags!: AttendanceFlag[];
  ipAddress!: string | null;
  userAgent!: string | null;
  notes!: string | null;
  userId!: string;
  branchId!: string;
  createdById!: string | null;
  adjustedById!: string | null;
  adjustedAt!: Date | null;
  adjustmentReason!: string | null;
  originalRecordedAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
  user!: AttendanceRefDto;
  branch!: AttendanceRefDto;
  createdBy!: AttendanceRefDto | null;
  adjustedBy!: AttendanceRefDto | null;
}

export class PaginatedAttendanceRecordsDto {
  data!: AttendanceRecordDto[];
  total!: number;
  page!: number;
  limit!: number;
  totalPages!: number;
}

export class AttendanceBranchGeofenceDto {
  id!: string;
  name!: string;
  latitude!: number | null;
  longitude!: number | null;
  geofenceRadiusM!: number;
}

export class AttendanceStatusDto {
  /** Lo que el usuario puede registrar ahora. */
  @ApiProperty({ enum: AttendanceType, enumName: 'AttendanceType' })
  nextType!: AttendanceType;
  /** Última checada del usuario (cualquier sucursal). */
  lastRecord!: AttendanceRecordDto | null;
  /** Hora de la entrada abierta, si la hay. */
  openSince!: Date | null;
  /** Sucursales donde puede checar, con su geocerca. */
  branches!: AttendanceBranchGeofenceDto[];
}

export class WorkSessionDto {
  /** Día local (YYYY-MM-DD) de la checada que abre la sesión. */
  date!: string;
  checkIn!: AttendanceRecordDto | null;
  checkOut!: AttendanceRecordDto | null;
  workedMinutes!: number;
  /** Falta la entrada o la salida. */
  incomplete!: boolean;
  /** Entrada abierta que aún puede cerrarse. */
  inProgress!: boolean;
}

export class MyAttendanceDto {
  from!: string;
  to!: string;
  totalWorkedMinutes!: number;
  sessions!: WorkSessionDto[];
}

export class AttendanceDayRowDto {
  userId!: string;
  userName!: string;
  date!: string;
  firstCheckIn!: Date | null;
  lastCheckOut!: Date | null;
  workedMinutes!: number;
  sessions!: number;
  incomplete!: boolean;
  inProgress!: boolean;
  flaggedCount!: number;
}

export class AttendanceUserTotalDto {
  userId!: string;
  userName!: string;
  workedMinutes!: number;
  daysWorked!: number;
  incompleteSessions!: number;
  flaggedCount!: number;
}

export class AttendanceSummaryDto {
  from!: string;
  to!: string;
  days!: AttendanceDayRowDto[];
  users!: AttendanceUserTotalDto[];
}

export class AttendanceUserOptionDto {
  id!: string;
  name!: string;
  email!: string;
}
