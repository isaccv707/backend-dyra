import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  catalogNameKey,
  resolveStudyCatalogIds,
} from '../../src/study-catalogs/utils/study-catalog.util';
import { StudyCatalogKind } from '../../src/study-catalogs/study-catalog.config';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const FIELDS: Array<{
  kind: StudyCatalogKind;
  legacy: 'legacySection' | 'legacySampleType' | 'legacyTechnique';
  fk: 'sectionId' | 'sampleTypeId' | 'techniqueId';
}> = [
  { kind: 'section', legacy: 'legacySection', fk: 'sectionId' },
  { kind: 'sampleType', legacy: 'legacySampleType', fk: 'sampleTypeId' },
  { kind: 'technique', legacy: 'legacyTechnique', fk: 'techniqueId' },
];

async function main() {
  for (const { kind, legacy, fk } of FIELDS) {
    const studies = await prisma.study.findMany({
      where: { [fk]: null },
      select: {
        id: true,
        branchId: true,
        legacySection: true,
        legacySampleType: true,
        legacyTechnique: true,
      },
    });

    const namesByBranch = new Map<string, string[]>();
    for (const study of studies) {
      const name = study[legacy]?.trim();
      if (!name) continue;
      const names = namesByBranch.get(study.branchId) ?? [];
      names.push(name);
      namesByBranch.set(study.branchId, names);
    }

    const idsByBranch = new Map<string, Map<string, number>>();
    for (const [branchId, names] of namesByBranch) {
      idsByBranch.set(
        branchId,
        await resolveStudyCatalogIds(prisma, kind, branchId, names, {
          createMissing: true,
        }),
      );
    }

    let linked = 0;
    for (const study of studies) {
      const name = study[legacy]?.trim();
      if (!name) continue;
      const id = idsByBranch.get(study.branchId)?.get(catalogNameKey(name));
      if (!id) continue;
      await prisma.study.update({
        where: { id: study.id },
        data: { [fk]: id },
      });
      linked++;
    }

    console.log(
      `✅ ${kind}: ${linked} estudio(s) vinculados en ${namesByBranch.size} sucursal(es).`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
