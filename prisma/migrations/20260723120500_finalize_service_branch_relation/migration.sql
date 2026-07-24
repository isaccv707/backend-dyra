-- Closing step of the Service<->Branch relation flip.
-- Run only after prisma/scripts/backfill-service-branch.ts has populated
-- services.branch_id for every existing row.

-- DropForeignKey
ALTER TABLE "_BranchToService" DROP CONSTRAINT "_BranchToService_A_fkey";
ALTER TABLE "_BranchToService" DROP CONSTRAINT "_BranchToService_B_fkey";

-- DropTable
DROP TABLE "_BranchToService";

-- AlterTable
ALTER TABLE "services" ALTER COLUMN "branch_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "services_branch_id_idx" ON "services"("branch_id");

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
