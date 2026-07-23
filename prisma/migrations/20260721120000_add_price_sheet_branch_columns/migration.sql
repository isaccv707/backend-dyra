-- AlterTable
-- Additive step of the Branch<->PriceSheets relation flip (1 branch : N price sheets).
-- branches.price_sheet_id is kept for now so the backfill script
-- (prisma/scripts/backfill-price-sheet-branch.ts) can still read it; it is
-- dropped in a later migration once the backfill has run.
ALTER TABLE "price_sheets" ADD COLUMN "branch_id" TEXT;
ALTER TABLE "price_sheets" ADD COLUMN "is_public" BOOLEAN NOT NULL DEFAULT false;
