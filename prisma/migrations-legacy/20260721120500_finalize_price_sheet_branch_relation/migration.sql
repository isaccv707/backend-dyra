-- Closing step of the Branch<->PriceSheets relation flip.
-- Run only after prisma/scripts/backfill-price-sheet-branch.ts has populated
-- price_sheets.branch_id for every existing row.

-- DropForeignKey
ALTER TABLE "branches" DROP CONSTRAINT "branches_price_sheet_id_fkey";

-- AlterTable
ALTER TABLE "branches" DROP COLUMN "price_sheet_id";

-- AlterTable
ALTER TABLE "price_sheets" ALTER COLUMN "branch_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "price_sheets_branch_id_idx" ON "price_sheets"("branch_id");

-- CreateIndex
-- Only one public price sheet per branch at a time.
CREATE UNIQUE INDEX "price_sheets_branch_public_unique" ON "price_sheets"("branch_id") WHERE "is_public" = true;

-- AddForeignKey
ALTER TABLE "price_sheets" ADD CONSTRAINT "price_sheets_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
