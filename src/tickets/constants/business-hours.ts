/**
 * Business hours of the IT team: the SLA only runs inside them.
 * Monday–Friday 9:00–17:00, Saturday 9:00–14:00, Sunday closed.
 */
export const BUSINESS_HOURS: Record<number, [number, number] | null> = {
  0: null, // domingo
  1: [9, 17],
  2: [9, 17],
  3: [9, 17],
  4: [9, 17],
  5: [9, 17],
  6: [9, 14], // sábado
};

/** Wall clock the schedule refers to (the laboratories' local time). */
export const BUSINESS_TIMEZONE =
  process.env.BUSINESS_TIMEZONE ?? 'America/Mexico_City';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Safety bound for the day-by-day walk (a year and a bit). */
const MAX_DAYS = 400;

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

/** Local calendar fields of an instant in BUSINESS_TIMEZONE. */
function localParts(date: Date) {
  const parts = Object.fromEntries(
    partsFormatter.formatToParts(date).map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Offset (ms) of BUSINESS_TIMEZONE from UTC at an instant. */
function offsetAt(instant: number) {
  const p = localParts(new Date(instant));
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** Instant of a local wall-clock time in BUSINESS_TIMEZONE. */
function localToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
) {
  const guess = Date.UTC(year, month - 1, day, hour);
  return guess - offsetAt(guess - offsetAt(guess));
}

/** Business window [start, end) of the local day that contains `instant`. */
function windowOfDay(instant: number) {
  const { year, month, day } = localParts(new Date(instant));
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const hours = BUSINESS_HOURS[weekday];
  const nextDay = localToInstant(year, month, day, 0) + DAY_MS + HOUR_MS * 2;
  return {
    window: hours
      ? {
          start: localToInstant(year, month, day, hours[0]),
          end: localToInstant(year, month, day, hours[1]),
        }
      : null,
    // Some instant inside the following local day.
    nextDay,
  };
}

/** Instant after adding `ms` of business time to `from`. */
export function addBusinessTime(from: Date, ms: number): Date {
  let cursor = from.getTime();
  let remaining = ms;
  for (let i = 0; i < MAX_DAYS; i++) {
    const { window, nextDay } = windowOfDay(cursor);
    if (window && cursor < window.end) {
      const start = Math.max(cursor, window.start);
      const available = window.end - start;
      if (remaining <= available) return new Date(start + remaining);
      remaining -= available;
    }
    const { year, month, day } = localParts(new Date(nextDay));
    cursor = localToInstant(year, month, day, 0);
  }
  throw new Error('addBusinessTime: no business hours found');
}

/** Business time (ms) elapsed between two instants. */
export function businessTimeBetween(from: Date, to: Date): number {
  let cursor = from.getTime();
  const end = to.getTime();
  let total = 0;
  for (let i = 0; i < MAX_DAYS && cursor < end; i++) {
    const { window, nextDay } = windowOfDay(cursor);
    if (window) {
      const start = Math.max(cursor, window.start);
      const stop = Math.min(end, window.end);
      if (stop > start) total += stop - start;
    }
    const { year, month, day } = localParts(new Date(nextDay));
    cursor = localToInstant(year, month, day, 0);
  }
  return total;
}
