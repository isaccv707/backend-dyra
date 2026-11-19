import { BUSINESS_TIMEZONE } from 'src/tickets/constants/business-hours';
import { MAX_SHIFT_MS } from '../attendance.constants';

export interface PunchLike {
  id: string;
  type: 'CHECK_IN' | 'CHECK_OUT';
  recordedAt: Date;
}

export interface WorkSession<T extends PunchLike = PunchLike> {
  /** Local calendar day (BUSINESS_TIMEZONE) of the punch that opens it. */
  date: string;
  checkIn: T | null;
  checkOut: T | null;
  /** Minutes between check-in and check-out; 0 if incomplete. */
  workedMinutes: number;
  /** Missing check-in or check-out (forgotten punch). */
  incomplete: boolean;
  /** Open check-in that can still be closed (within MAX_SHIFT_MS of `now`). */
  inProgress: boolean;
}

const localDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** `YYYY-MM-DD` of an instant in the laboratory's time zone. */
export function toLocalDate(date: Date): string {
  return localDateFormatter.format(date);
}

/**
 * Pairs the punches of ONE user into work sessions. Punches are sorted by
 * `recordedAt`; a CHECK_IN closes with the next CHECK_OUT if it comes within
 * MAX_SHIFT_MS. Unpaired punches become incomplete sessions, except a last
 * check-in that can still be closed at `now` (in progress).
 */
export function buildWorkSessions<T extends PunchLike>(
  punches: T[],
  now: Date = new Date(),
): WorkSession<T>[] {
  const sorted = [...punches].sort(
    (a, b) => a.recordedAt.getTime() - b.recordedAt.getTime(),
  );
  const sessions: WorkSession<T>[] = [];
  let open: T | null = null;

  const closeOpenAsIncomplete = (inProgress = false) => {
    if (!open) return;
    sessions.push({
      date: toLocalDate(open.recordedAt),
      checkIn: open,
      checkOut: null,
      workedMinutes: 0,
      incomplete: !inProgress,
      inProgress,
    });
    open = null;
  };

  for (const punch of sorted) {
    if (punch.type === 'CHECK_IN') {
      closeOpenAsIncomplete();
      open = punch;
      continue;
    }

    const openIn = open;
    const elapsed = openIn
      ? punch.recordedAt.getTime() - openIn.recordedAt.getTime()
      : Infinity;

    if (openIn && elapsed <= MAX_SHIFT_MS) {
      sessions.push({
        date: toLocalDate(openIn.recordedAt),
        checkIn: openIn,
        checkOut: punch,
        workedMinutes: Math.round(elapsed / 60_000),
        incomplete: false,
        inProgress: false,
      });
      open = null;
    } else {
      closeOpenAsIncomplete();
      sessions.push({
        date: toLocalDate(punch.recordedAt),
        checkIn: null,
        checkOut: punch,
        workedMinutes: 0,
        incomplete: true,
        inProgress: false,
      });
    }
  }

  const last = open;
  closeOpenAsIncomplete(
    !!last && now.getTime() - last.recordedAt.getTime() <= MAX_SHIFT_MS,
  );
  return sessions;
}
