-- CreateTable
CREATE TABLE "study_providers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "branch_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "study_providers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "study_providers_branch_id_idx" ON "study_providers"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "study_providers_branch_id_name_key" ON "study_providers"("branch_id", "name");

-- AddForeignKey
ALTER TABLE "study_providers" ADD CONSTRAINT "study_providers_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "studies" ADD COLUMN "provider_id" TEXT;

-- Backfill: one provider per (branch, providerName) already typed on studies.
INSERT INTO "study_providers" ("id", "name", "branch_id", "updatedAt")
SELECT gen_random_uuid()::text, p."name", p."branch_id", CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT ON ("branch_id", lower(trim("providerName")))
        "branch_id", trim("providerName") AS "name"
    FROM "studies"
    WHERE "providerName" IS NOT NULL AND trim("providerName") <> ''
    ORDER BY "branch_id", lower(trim("providerName"))
) p;

UPDATE "studies" s
SET "provider_id" = p."id"
FROM "study_providers" p
WHERE p."branch_id" = s."branch_id"
  AND lower(p."name") = lower(trim(s."providerName"));

-- AlterTable
ALTER TABLE "studies" DROP COLUMN "providerName";

-- CreateIndex
CREATE INDEX "studies_provider_id_idx" ON "studies"("provider_id");

-- AddForeignKey
ALTER TABLE "studies" ADD CONSTRAINT "studies_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "study_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
