import { Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from 'prisma/prisma/prisma.service';
import type { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { userBranchFilter } from 'src/common/utils/branch-access.util';
import { BUSINESS_TIMEZONE } from 'src/tickets/constants/business-hours';
import { resolveRange } from '../attendance.shared';
import { AttendanceSummaryQueryDto } from '../dto/find-attendance.dto';
import { AttendanceQueryService } from './attendance-query.service';

const TYPE_LABEL = { CHECK_IN: 'Entrada', CHECK_OUT: 'Salida' } as const;
const STATUS_LABEL = {
  VALID: 'Válida',
  FLAGGED: 'Por revisar',
  ADJUSTED: 'Ajustada',
} as const;
const SOURCE_LABEL = { DEVICE: 'Dispositivo', MANUAL: 'Manual' } as const;
const FLAG_LABEL = {
  OUTSIDE_GEOFENCE: 'Fuera de la sucursal',
  LOW_ACCURACY: 'Baja precisión',
  CLOCK_SKEW: 'Reloj desfasado',
} as const;

const dateTimeFormatter = new Intl.DateTimeFormat('es-MX', {
  timeZone: BUSINESS_TIMEZONE,
  dateStyle: 'short',
  timeStyle: 'short',
});
const timeFormatter = new Intl.DateTimeFormat('es-MX', {
  timeZone: BUSINESS_TIMEZONE,
  timeStyle: 'short',
});

const formatHours = (minutes: number) =>
  `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;

/** Excel export: summary per user/day and every punch of the range. */
@Injectable()
export class AttendanceExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: AttendanceQueryService,
  ) {}

  async export(dto: AttendanceSummaryQueryDto, user: RequestUser) {
    const range = resolveRange(dto.from, dto.to);
    const [summary, records] = await Promise.all([
      this.query.summary({ ...dto, from: range.from, to: range.to }, user),
      this.prisma.attendanceRecord.findMany({
        where: {
          ...userBranchFilter(user, dto.branchId),
          ...(dto.userId && { userId: dto.userId }),
          recordedAt: { gte: range.gte, lt: range.lt },
        },
        orderBy: [{ user: { name: 'asc' } }, { recordedAt: 'asc' }],
        include: {
          user: { select: { name: true } },
          branch: { select: { name: true } },
          adjustedBy: { select: { name: true } },
          createdBy: { select: { name: true } },
        },
      }),
    ]);

    const summaryRows = summary.days.map((d) => ({
      Usuario: d.userName,
      Fecha: d.date,
      'Primera entrada': d.firstCheckIn
        ? timeFormatter.format(d.firstCheckIn)
        : '',
      'Última salida': d.lastCheckOut
        ? timeFormatter.format(d.lastCheckOut)
        : '',
      'Horas trabajadas': formatHours(d.workedMinutes),
      Sesiones: d.sessions,
      Incompleta: d.incomplete ? 'Sí' : 'No',
      'Por revisar': d.flaggedCount,
    }));

    const totalRows = summary.users.map((u) => ({
      Usuario: u.userName,
      'Horas trabajadas': formatHours(u.workedMinutes),
      'Días trabajados': u.daysWorked,
      'Sesiones incompletas': u.incompleteSessions,
      'Por revisar': u.flaggedCount,
    }));

    const recordRows = records.map((r) => ({
      Usuario: r.user.name,
      Sucursal: r.branch.name,
      Tipo: TYPE_LABEL[r.type],
      'Fecha y hora': dateTimeFormatter.format(r.recordedAt),
      Estatus: STATUS_LABEL[r.status],
      Origen: SOURCE_LABEL[r.source],
      Latitud: r.latitude ?? '',
      Longitud: r.longitude ?? '',
      'Precisión (m)': r.accuracyM ?? '',
      'Distancia (m)': r.distanceM ?? '',
      Alertas: r.flags.map((f) => FLAG_LABEL[f]).join(', '),
      Notas: r.notes ?? '',
      'Registrada por': r.createdBy?.name ?? '',
      'Revisada por': r.adjustedBy?.name ?? '',
      'Motivo de revisión': r.adjustmentReason ?? '',
      'Hora original': r.originalRecordedAt
        ? dateTimeFormatter.format(r.originalRecordedAt)
        : '',
    }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(totalRows),
      'Totales',
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(summaryRows),
      'Por día',
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(recordRows),
      'Checadas',
    );

    const buffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
    }) as Buffer;

    return { buffer, filename: `asistencia-${range.from}-a-${range.to}.xlsx` };
  }
}
