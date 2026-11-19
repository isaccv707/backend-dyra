/** A GPS reading less precise than this (meters) is flagged LOW_ACCURACY. */
export const MAX_ACCURACY_M = 200;

/**
 * Part of the reported accuracy that is tolerated on top of the branch radius
 * before flagging OUTSIDE_GEOFENCE (a 30 m reading near the edge is not "out").
 */
export const MAX_ACCURACY_TOLERANCE_M = 100;

/** Client clock drift (ms) tolerated before flagging CLOCK_SKEW. */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * An open check-in older than this (ms) is considered forgotten: the user can
 * check in again and can no longer check out against it.
 */
export const MAX_SHIFT_MS = 16 * 60 * 60 * 1000;

/** Longest date range (days) accepted by summaries and exports. */
export const MAX_RANGE_DAYS = 93;

/** Default range (days, today included) when `from`/`to` are omitted. */
export const DEFAULT_RANGE_DAYS = 7;
