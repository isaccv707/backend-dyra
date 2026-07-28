// One-off script. Run after the additive migration that adds
// PriceSheets.branchId (nullable) and PriceSheets.isPublic, and BEFORE the
// closing migration that drops Branch.priceSheetId and makes
// PriceSheets.branchId required.
//
// For every Branch that still has a legacy price_sheet_id: the first branch
// to claim a given sheet keeps it (branchId = that branch, isPublic = true).
// Any additional branch sharing the same sheet gets a duplicate of it
// (including its StudyOnPriceSheet rows), also marked isPublic = true.
//
// Usage: npx ts-node prisma/scripts/backfill-price-sheet-branch.ts
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const branches = await prisma.$queryRaw<{ id: string; price_sheet_id: string | null }[]>`
    SELECT id, price_sheet_id FROM branches WHERE price_sheet_id IS NOT NULL
  `;

  const claimed = new Set<string>();
  let assigned = 0;
  let duplicated = 0;

  for (const branch of branches) {
    const sheetId = branch.price_sheet_id!;

    if (!claimed.has(sheetId)) {
      await prisma.priceSheets.update({
        where: { id: sheetId },
        data: { branchId: branch.id, isPublic: true },
      });
      claimed.add(sheetId);
      assigned++;
      continue;
    }

    const original = await prisma.priceSheets.findUniqueOrThrow({
      where: { id: sheetId },
      include: { studyOnPriceSheets: true },
    });

    await prisma.priceSheets.create({
      data: {
        name: original.name,
        description: original.description,
        isActive: original.isActive,
        isPublic: true,
        branchId: branch.id,
        studyOnPriceSheets: {
          create: original.studyOnPriceSheets.map((entry) => ({
            studyId: entry.studyId,
            price: entry.price,
            showPrice: entry.showPrice,
          })),
        },
      },
    });
    duplicated++;
  }

  console.log(
    `✅ Backfill finished. ${assigned} price sheet(s) assigned to their original branch, ${duplicated} duplicated for shared branches.`,
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
