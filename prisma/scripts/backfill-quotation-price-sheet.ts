// One-off script. Run after the additive `npx prisma db push` that adds
// Quotation.priceSheetId (nullable), and BEFORE the closing schema change
// that makes it required.
//
// Every pre-existing quotation was created through the old public flow,
// which always priced catalog studies against the branch's public price
// sheet (see the old resolveQuotationItems fallback). Backfill assigns each
// quotation its branch's current public+active price sheet. Quotations
// whose branch has no public price sheet configured are logged for manual
// review — running the closing `db push` step will fail for them until
// fixed.
//
// Usage: npx ts-node prisma/scripts/backfill-quotation-price-sheet.ts
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
