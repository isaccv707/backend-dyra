import { AttendanceType } from '@prisma/client';
import { resolveRange } from '../attendance.shared';
import { distanceInMeters } from './geo.util';
import { evaluateLocation, nextPunchType } from './punch-rules.util';
import { buildWorkSessions, toLocalDate } from './work-sessions.util';

const HOUR = 60 * 60 * 1000;
// Guadalajara cathedral and Expiatorio temple: ~1.29 km apart.
const CATHEDRAL = { latitude: 20.676944, longitude: -103.347222 };
const EXPIATORIO = { latitude: 20.673236, longitude: -103.358964 };

describe('distanceInMeters', () => {
  it('is 0 for the same point', () => {
    expect(distanceInMeters(CATHEDRAL, CATHEDRAL)).toBe(0);
  });

  it('matches a known distance within 1%', () => {
    const d = distanceInMeters(CATHEDRAL, EXPIATORIO);
    expect(d).toBeGreaterThan(1280);
    expect(d).toBeLessThan(1300);
  });
});

describe('evaluateLocation', () => {
  const now = new Date('2026-11-13T15:00:00Z');
  const branch = { ...CATHEDRAL, geofenceRadiusM: 150 };

  it('is valid inside the geofence with good accuracy', () => {
    const result = evaluateLocation(
      branch,
      { ...CATHEDRAL, accuracyM: 15, clientTimestamp: now },
      now,
    );
    expect(result).toEqual({ distanceM: 0, withinGeofence: true, flags: [] });
  });

  it('flags OUTSIDE_GEOFENCE far from the branch', () => {
    const result = evaluateLocation(
      branch,
      { ...EXPIATORIO, accuracyM: 10 },
      now,
    );
    expect(result.withinGeofence).toBe(false);
    expect(result.flags).toEqual(['OUTSIDE_GEOFENCE']);
  });

  it('tolerates the reading accuracy (capped) at the edge', () => {
    // ~200 m north: outside 150 m, inside 150 + 60 accuracy.
    const edge = {
      latitude: CATHEDRAL.latitude + 0.0018,
      longitude: CATHEDRAL.longitude,
    };
    expect(
      evaluateLocation(branch, { ...edge, accuracyM: 60 }, now).withinGeofence,
    ).toBe(true);
    expect(
      evaluateLocation(branch, { ...edge, accuracyM: 5 }, now).withinGeofence,
    ).toBe(false);
  });

  it('flags LOW_ACCURACY and CLOCK_SKEW', () => {
    const result = evaluateLocation(
      branch,
      {
        ...CATHEDRAL,
        accuracyM: 500,
        clientTimestamp: new Date(now.getTime() - 10 * 60 * 1000),
      },
      now,
    );
    expect(result.flags).toEqual(['LOW_ACCURACY', 'CLOCK_SKEW']);
  });

  it('skips the geofence when the branch has no coordinates', () => {
    const result = evaluateLocation(
      { latitude: null, longitude: null, geofenceRadiusM: 150 },
      { ...CATHEDRAL, accuracyM: 10 },
      now,
    );
    expect(result).toEqual({
      distanceM: null,
      withinGeofence: null,
      flags: [],
    });
  });
});

describe('nextPunchType', () => {
  const now = new Date('2026-11-13T15:00:00Z');

  it('starts with CHECK_IN', () => {
    expect(nextPunchType(null, now)).toBe(AttendanceType.CHECK_IN);
  });

  it('expects CHECK_OUT after a recent CHECK_IN', () => {
    expect(
      nextPunchType(
        { type: 'CHECK_IN', recordedAt: new Date(now.getTime() - 8 * HOUR) },
        now,
      ),
    ).toBe(AttendanceType.CHECK_OUT);
  });

  it('treats a check-in older than 16 h as forgotten', () => {
    expect(
      nextPunchType(
        { type: 'CHECK_IN', recordedAt: new Date(now.getTime() - 17 * HOUR) },
        now,
      ),
    ).toBe(AttendanceType.CHECK_IN);
  });

  it('expects CHECK_IN after a CHECK_OUT', () => {
    expect(nextPunchType({ type: 'CHECK_OUT', recordedAt: now }, now)).toBe(
      AttendanceType.CHECK_IN,
    );
  });
});

describe('buildWorkSessions', () => {
  const at = (iso: string) => new Date(iso);
  const punch = (id: string, type: 'CHECK_IN' | 'CHECK_OUT', iso: string) => ({
    id,
    type,
    recordedAt: at(iso),
  });
  const now = at('2026-11-20T00:00:00Z');

  it('pairs check-in/check-out and counts minutes', () => {
    const sessions = buildWorkSessions(
      [
        punch('2', 'CHECK_OUT', '2026-11-13T23:30:00Z'),
        punch('1', 'CHECK_IN', '2026-11-13T15:00:00Z'),
      ],
      now,
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      date: '2026-11-13',
      workedMinutes: 510,
      incomplete: false,
      inProgress: false,
    });
  });

  it('assigns a night shift to the local day of the check-in', () => {
    // 22:00 local (UTC-6) on the 13th until 06:00 on the 14th.
    const sessions = buildWorkSessions(
      [
        punch('1', 'CHECK_IN', '2026-11-14T04:00:00Z'),
        punch('2', 'CHECK_OUT', '2026-11-14T12:00:00Z'),
      ],
      now,
    );
    expect(sessions[0]).toMatchObject({
      date: '2026-11-13',
      workedMinutes: 480,
    });
  });

  it('marks forgotten punches as incomplete', () => {
    const sessions = buildWorkSessions(
      [
        punch('1', 'CHECK_IN', '2026-11-13T15:00:00Z'),
        punch('2', 'CHECK_IN', '2026-11-14T15:00:00Z'),
        punch('3', 'CHECK_OUT', '2026-11-14T23:00:00Z'),
        punch('4', 'CHECK_OUT', '2026-11-15T23:00:00Z'),
      ],
      now,
    );
    expect(
      sessions.map((s) => [
        s.checkIn?.id ?? null,
        s.checkOut?.id ?? null,
        s.incomplete,
      ]),
    ).toEqual([
      ['1', null, true],
      ['2', '3', false],
      [null, '4', true],
    ]);
  });

  it('keeps a recent open check-in in progress', () => {
    const open = at('2026-11-19T20:00:00Z');
    const [session] = buildWorkSessions(
      [{ id: '1', type: 'CHECK_IN', recordedAt: open }],
      now,
    );
    expect(session).toMatchObject({ incomplete: false, inProgress: true });
  });
});

describe('resolveRange', () => {
  const now = new Date('2026-11-13T18:00:00Z');

  it('defaults to the last 7 local days', () => {
    const range = resolveRange(undefined, undefined, now);
    expect(range.from).toBe('2026-11-07');
    expect(range.to).toBe('2026-11-13');
    expect(toLocalDate(range.gte)).toBe('2026-11-07');
    expect(range.lt.toISOString()).toBe('2026-11-14T06:00:00.000Z');
  });

  it('rejects inverted and too long ranges', () => {
    expect(() => resolveRange('2026-11-10', '2026-11-01', now)).toThrow(
      'La fecha inicial no puede ser posterior a la fecha final',
    );
    expect(() => resolveRange('2026-01-01', '2026-11-01', now)).toThrow(
      'El rango no puede ser mayor a 93 días',
    );
  });
});
