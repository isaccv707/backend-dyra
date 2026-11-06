import { Prisma } from '@prisma/client';

// AVG() de Postgres es numeric: Prisma lo entrega como Decimal (string en JSON).
export type RawAvg = Prisma.Decimal | number | null;

export interface SummaryDurationRow {
  avg_first_response_seconds: RawAvg;
  avg_resolution_seconds: RawAvg;
  reopened: bigint;
  overdue: bigint;
}

export interface GroupDurationRow {
  group_key: string | null;
  avg_resolution_seconds: RawAvg;
}

export interface TrendRow {
  bucket: string;
  count: bigint;
}

export const toSeconds = (value: RawAvg): number | null =>
  value === null || value === undefined ? null : Number(value);
