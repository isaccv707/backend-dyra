import { Prisma } from '@prisma/client';
import { StudyCatalogKind } from '../study-catalog.config';

export type StudyCatalogRow = {
  id: number;
  name: string;
  isActive: boolean;
  branchId: string;
  createdAt: Date;
  updatedAt: Date;
};

export interface StudyCatalogDelegate {
  findUnique(args: {
    where: { id: number };
    include?: Record<string, unknown>;
  }): Promise<StudyCatalogRow | null>;
  findFirst(args: {
    where: Record<string, unknown>;
  }): Promise<StudyCatalogRow | null>;
  findMany(args: Record<string, unknown>): Promise<StudyCatalogRow[]>;
  count(args: { where: Record<string, unknown> }): Promise<number>;
  create(args: {
    data: { name: string; branchId: string; isActive?: boolean };
  }): Promise<StudyCatalogRow>;
  createMany(args: {
    data: Array<{ name: string; branchId: string }>;
    skipDuplicates?: boolean;
  }): Promise<{ count: number }>;
  update(args: {
    where: { id: number };
    data: { name?: string; isActive?: boolean };
  }): Promise<StudyCatalogRow>;
  delete(args: { where: { id: number } }): Promise<StudyCatalogRow>;
}

type Db = Prisma.TransactionClient;

export function studyCatalogDelegate(
  db: Db,
  kind: StudyCatalogKind,
): StudyCatalogDelegate {
  const delegates = {
    section: db.studySection,
    sampleType: db.sampleType,
    technique: db.studyTechnique,
  };
  return delegates[kind] as unknown as StudyCatalogDelegate;
}

export const catalogNameKey = (name: string) => name.trim().toLowerCase();

export async function resolveStudyCatalogIds(
  db: Db,
  kind: StudyCatalogKind,
  branchId: string,
  names: Iterable<string>,
  { createMissing }: { createMissing: boolean },
): Promise<Map<string, number>> {
  const byKey = new Map<string, string>();
  for (const name of names) {
    const trimmed = name.trim();
    if (trimmed && !byKey.has(catalogNameKey(trimmed))) {
      byKey.set(catalogNameKey(trimmed), trimmed);
    }
  }
  if (!byKey.size) return new Map();

  const delegate = studyCatalogDelegate(db, kind);
  const find = () =>
    delegate.findMany({
      where: {
        branchId,
        OR: [...byKey.values()].map((name) => ({
          name: { equals: name, mode: 'insensitive' },
        })),
      },
      select: { id: true, name: true },
    });

  let existing = await find();
  if (createMissing) {
    const found = new Set(existing.map((row) => catalogNameKey(row.name)));
    const missing = [...byKey.entries()].filter(([key]) => !found.has(key));
    if (missing.length) {
      await delegate.createMany({
        data: missing.map(([, name]) => ({ name, branchId })),
        skipDuplicates: true,
      });
      existing = await find();
    }
  }

  return new Map(existing.map((row) => [catalogNameKey(row.name), row.id]));
}
