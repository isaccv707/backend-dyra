import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const quotations = await prisma.$queryRaw<{ id: string; branchId: string }[]>`
    SELECT id, "branchId" FROM quotations WHERE "priceSheetId" IS NULL
  `;

  let assigned = 0;
  const unresolved: string[] = [];

  for (const quotation of quotations) {
    const publicSheet = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM price_sheets
      WHERE branch_id = ${quotation.branchId} AND is_public = true AND "isActive" = true
      LIMIT 1
    `;

    if (!publicSheet[0]) {
      unresolved.push(quotation.id);
      continue;
    }

    await prisma.$executeRaw`
      UPDATE quotations SET "priceSheetId" = ${publicSheet[0].id} WHERE id = ${quotation.id}
    `;
    assigned++;
  }

  console.log(`✅ Backfill finished. ${assigned} quotation(s) assigned a price sheet.`);
  if (unresolved.length) {
    console.warn(
      `⚠️  ${unresolved.length} quotation(s) could not be resolved (branch has no public/active price sheet): ${unresolved.join(', ')}`,
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
