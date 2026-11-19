import { AttendanceFlag, AttendanceType } from '@prisma/client';
import {
  MAX_ACCURACY_M,
  MAX_ACCURACY_TOLERANCE_M,
  MAX_CLOCK_SKEW_MS,
  MAX_SHIFT_MS,
} from '../attendance.constants';
import { distanceInMeters } from './geo.util';

export interface BranchGeofence {
  latitude: number | null;
  longitude: number | null;
  geofenceRadiusM: number;
}

export interface PunchReading {
  latitude: number;
  longitude: number;
  accuracyM: number;
  clientTimestamp?: Date | null;
}

export interface LocationCheck {
  distanceM: number | null;
  withinGeofence: boolean | null;
  flags: AttendanceFlag[];
}

/**
 * Compares a reading with the branch geofence. Never rejects: anything odd is
 * returned as flags so a supervisor can review it.
 */
export function evaluateLocation(
  branch: BranchGeofence,
  reading: PunchReading,
  now: Date,
): LocationCheck {
  const flags: AttendanceFlag[] = [];
  let distanceM: number | null = null;
  let withinGeofence: boolean | null = null;

  if (branch.latitude !== null && branch.longitude !== null) {
    distanceM = distanceInMeters(
      { latitude: branch.latitude, longitude: branch.longitude },
      reading,
    );
    const tolerance = Math.min(reading.accuracyM, MAX_ACCURACY_TOLERANCE_M);
    withinGeofence = distanceM <= branch.geofenceRadiusM + tolerance;
    if (!withinGeofence) flags.push(AttendanceFlag.OUTSIDE_GEOFENCE);
  }

  if (reading.accuracyM > MAX_ACCURACY_M) {
    flags.push(AttendanceFlag.LOW_ACCURACY);
  }

  if (
    reading.clientTimestamp &&
    Math.abs(reading.clientTimestamp.getTime() - now.getTime()) >
      MAX_CLOCK_SKEW_MS
  ) {
    flags.push(AttendanceFlag.CLOCK_SKEW);
  }

  return {
    distanceM: distanceM === null ? null : Math.round(distanceM * 10) / 10,
    withinGeofence,
    flags,
  };
}

export interface LastPunch {
  type: AttendanceType;
  recordedAt: Date;
}

/**
 * What the user can punch now: CHECK_OUT only while a check-in is open and
 * younger than MAX_SHIFT_MS (an older one counts as forgotten).
 */
export function nextPunchType(
  last: LastPunch | null,
  now: Date,
): AttendanceType {
  const hasOpenCheckIn =
    last?.type === AttendanceType.CHECK_IN &&
    now.getTime() - last.recordedAt.getTime() <= MAX_SHIFT_MS;
  return hasOpenCheckIn ? AttendanceType.CHECK_OUT : AttendanceType.CHECK_IN;
}
