-- AlterTable
-- Additive step of the Service<->Branch relation flip
-- (many-to-many via _BranchToService -> 1 branch : N services).
-- services.branch_id is nullable for now so the backfill script
-- (prisma/scripts/backfill-service-branch.ts) can populate it; it is made
-- required and the old join table is dropped in a later migration.
ALTER TABLE "services" ADD COLUMN "branch_id" TEXT;
