-- Category NETWORK (Red) se elimina: sus tickets y subcategorías pasan a OTHER.
-- Una subcategoría de Red cuyo nombre ya existe en Otro se fusiona con esa.
UPDATE "tickets" AS t
SET "subcategory_id" = other."id"
FROM "ticket_subcategories" AS network
JOIN "ticket_subcategories" AS other
  ON other."category" = 'OTHER' AND other."name" = network."name"
WHERE network."category" = 'NETWORK' AND t."subcategory_id" = network."id";

DELETE FROM "ticket_subcategories" AS network
USING "ticket_subcategories" AS other
WHERE network."category" = 'NETWORK'
  AND other."category" = 'OTHER'
  AND other."name" = network."name";

UPDATE "ticket_subcategories" SET "category" = 'OTHER' WHERE "category" = 'NETWORK';
UPDATE "tickets" SET "category" = 'OTHER' WHERE "category" = 'NETWORK';

-- CreateEnum
CREATE TYPE "TicketFormType" AS ENUM ('SOFTWARE_REMOTE', 'ACCESS_REQUEST', 'STUDY_CREATE', 'STUDY_UPDATE', 'CLIENT_CREATE');

-- AlterEnum
BEGIN;
CREATE TYPE "Category_new" AS ENUM ('HARDWARE', 'SOFTWARE', 'ACCESS', 'COGNITI', 'OTHER');
ALTER TABLE "ticket_subcategories" ALTER COLUMN "category" TYPE "Category_new" USING ("category"::text::"Category_new");
ALTER TABLE "tickets" ALTER COLUMN "category" TYPE "Category_new" USING ("category"::text::"Category_new");
ALTER TYPE "Category" RENAME TO "Category_old";
ALTER TYPE "Category_new" RENAME TO "Category";
DROP TYPE "public"."Category_old";
COMMIT;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TicketEventType" ADD VALUE 'FORM_UPDATED';
ALTER TYPE "TicketEventType" ADD VALUE 'FORM_APPLIED';

-- AlterTable
ALTER TABLE "ticket_subcategories" ADD COLUMN     "form_type" "TicketFormType";

-- AlterTable
ALTER TABLE "tickets" ALTER COLUMN "description" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ticket_forms" (
    "id" TEXT NOT NULL,
    "type" "TicketFormType" NOT NULL,
    "data" JSONB NOT NULL,
    "result" JSONB,
    "ticket_id" TEXT NOT NULL,
    "applied_at" TIMESTAMP(3),
    "applied_by_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_forms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ticket_forms_ticket_id_key" ON "ticket_forms"("ticket_id");

-- CreateIndex
CREATE INDEX "ticket_forms_type_applied_at_idx" ON "ticket_forms"("type", "applied_at");

-- AddForeignKey
ALTER TABLE "ticket_forms" ADD CONSTRAINT "ticket_forms_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_forms" ADD CONSTRAINT "ticket_forms_applied_by_id_fkey" FOREIGN KEY ("applied_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

