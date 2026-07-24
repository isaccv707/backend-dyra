// One-off script. Run after the additive migration that adds
// Service.branchId (nullable), and BEFORE the closing migration that drops
// the _BranchToService join table and makes Service.branchId required.
//
// For every Service still linked via the legacy _BranchToService m2m table:
// takes its (single) linked branch. Services with no branch linked (the
// former "global" services) fall back to DEFAULT_BRANCH_ID.
//
// Usage: npx ts-node prisma/scripts/backfill-service-branch.ts
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const DEFAULT_BRANCH_ID = 'a1b2c3d4-0001-4000-8000-000000000001'; // Sucursal Guadalajara

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const links = await prisma.$queryRaw<{ service_id: string; branch_id: string }[]>`
    SELECT "B" as service_id, "A" as branch_id FROM "_BranchToService"
  `;
  const linkedBranchByService = new Map(links.map((l) => [l.service_id, l.branch_id]));

  const services = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM services
  `;

  let linked = 0;
  let defaulted = 0;

  for (const service of services) {
    const branchId = linkedBranchByService.get(service.id) ?? DEFAULT_BRANCH_ID;
    await prisma.$executeRaw`
      UPDATE services SET branch_id = ${branchId} WHERE id = ${service.id}
    `;
    if (linkedBranchByService.has(service.id)) linked++;
    else defaulted++;
  }

  console.log(
    `✅ Backfill finished. ${linked} service(s) kept their existing branch, ${defaulted} defaulted to ${DEFAULT_BRANCH_ID}.`,
  );
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
