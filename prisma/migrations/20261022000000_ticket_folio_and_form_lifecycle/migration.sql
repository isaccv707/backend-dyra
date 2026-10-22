-- CreateEnum
CREATE TYPE "TicketNotificationKind" AS ENUM ('COMMENT', 'CHANGE', 'ASSIGNMENT', 'OVERDUE', 'FORM');

-- AlterEnum
ALTER TYPE "TicketEventType" ADD VALUE 'FORM_REJECTED';

-- DropIndex
DROP INDEX "tickets_code_key";

-- AlterTable
ALTER TABLE "ticket_forms" ADD COLUMN     "rejected_at" TIMESTAMP(3),
ADD COLUMN     "rejected_by_id" TEXT,
ADD COLUMN     "rejection_reason" TEXT,
ADD COLUMN     "schema_version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "ticket_notifications" ADD COLUMN     "actor_id" TEXT,
ADD COLUMN     "kind" "TicketNotificationKind" NOT NULL DEFAULT 'CHANGE';

-- AlterTable
ALTER TABLE "tickets" ALTER COLUMN "code" DROP DEFAULT;
DROP SEQUENCE "tickets_code_seq";

-- CreateTable
CREATE TABLE "ticket_counters" (
    "branch_id" TEXT NOT NULL,
    "last_code" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ticket_counters_pkey" PRIMARY KEY ("branch_id")
);

-- CreateIndex
CREATE INDEX "ticket_notifications_read_createdAt_idx" ON "ticket_notifications"("read", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_branch_id_code_key" ON "tickets"("branch_id", "code");

-- AddForeignKey
ALTER TABLE "ticket_notifications" ADD CONSTRAINT "ticket_notifications_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_counters" ADD CONSTRAINT "ticket_counters_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_forms" ADD CONSTRAINT "ticket_forms_rejected_by_id_fkey" FOREIGN KEY ("rejected_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Folio per branch: existing tickets keep their code; each branch continues from its highest one.
INSERT INTO "ticket_counters" ("branch_id", "last_code")
SELECT "branch_id", MAX("code") FROM "tickets" GROUP BY "branch_id";
