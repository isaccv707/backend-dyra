// One-off script. Fase 1 de la migración de Study.section / sampleType /
// technique (texto libre) a los catálogos por sucursal StudySection,
// SampleType y StudyTechnique.
//
// Correr DESPUÉS de desplegar el schema que agrega los catálogos y las FKs
// (section_id, sample_type_id, technique_id), y ANTES de la fase 2 que
// elimina las columnas de texto (legacySection/legacySampleType/
// legacyTechnique en schema.prisma).
//
// Por cada estudio con FK vacía y texto capturado: busca en el catálogo de
// SU sucursal un registro con ese nombre (sin distinguir mayúsculas), lo
// crea si no existe, y llena la FK. Es idempotente: se puede volver a correr.
//
// Usage: npx ts-node prisma/scripts/backfill-study-catalogs.ts
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
      // El texto vacío/null se descarta abajo (section es NOT NULL en DB, así
      // que no admite un filtro `not: null` uniforme para los tres campos).
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
