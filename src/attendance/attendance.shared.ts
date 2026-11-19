import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { startOfLocalDay } from 'src/tickets/constants/business-hours';
import { DEFAULT_RANGE_DAYS, MAX_RANGE_DAYS } from './attendance.constants';
import { toLocalDate } from './utils/work-sessions.util';

const REF = { select: { id: true, name: true } } as const;

export const ATTENDANCE_RECORD_INCLUDE = {
  user: REF,
  branch: REF,
  createdBy: REF,
  adjustedBy: REF,
} satisfies Prisma.AttendanceRecordInclude;

export type AttendanceRecordWithRelations = Prisma.AttendanceRecordGetPayload<{
  include: typeof ATTENDANCE_RECORD_INCLUDE;
}>;

export interface ResolvedRange {
  from: string;
  to: string;
  /** Start of `from` (inclusive). */
  gte: Date;
  /** Start of the day after `to` (exclusive). */
  lt: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const dayNumber = (dateOnly: string) => {
  const [y, m, d] = dateOnly.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};

/**
 * Local-day range [from, to]. Missing bounds default to the last
 * DEFAULT_RANGE_DAYS days ending today (or starting at `from`).
 */
export function resolveRange(
  from?: string,
  to?: string,
  now: Date = new Date(),
): ResolvedRange {
  const today = toLocalDate(now);
  const span = DEFAULT_RANGE_DAYS - 1;

  const resolvedTo =
    to ?? (from ? toLocalDate(startOfLocalDay(from, span)) : today);
  const resolvedFrom = from ?? toLocalDate(startOfLocalDay(resolvedTo, -span));

  const days = dayNumber(resolvedTo) - dayNumber(resolvedFrom) + 1;
  if (days < 1) {
    throw new BadRequestException(
      'La fecha inicial no puede ser posterior a la fecha final',
    );
  }
  if (days > MAX_RANGE_DAYS) {
    throw new BadRequestException(
      `El rango no puede ser mayor a ${MAX_RANGE_DAYS} días`,
    );
  }

  return {
    from: resolvedFrom,
    to: resolvedTo,
    gte: startOfLocalDay(resolvedFrom),
    lt: startOfLocalDay(resolvedTo, 1),
  };
}
