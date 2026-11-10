-- CreateEnum
CREATE TYPE "ContactMessageStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'RESOLVED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "ContactMessageSubject" AS ENUM ('CLINICAL_ANALYSIS', 'CORPORATE_HEALTH', 'HOME_SAMPLING', 'OTHER');

-- CreateTable
CREATE TABLE "contact_messages" (
    "id" TEXT NOT NULL,
    "folio" SERIAL NOT NULL,
    "branch_id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "subject" "ContactMessageSubject" NOT NULL,
    "message" TEXT NOT NULL,
    "status" "ContactMessageStatus" NOT NULL DEFAULT 'NEW',
    "privacy_accepted_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_message_status_changes" (
    "id" SERIAL NOT NULL,
    "contact_message_id" TEXT NOT NULL,
    "from_status" "ContactMessageStatus",
    "to_status" "ContactMessageStatus" NOT NULL,
    "note" TEXT,
    "changed_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_message_status_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contact_messages_folio_key" ON "contact_messages"("folio");

-- CreateIndex
CREATE INDEX "contact_messages_branch_id_status_created_at_idx" ON "contact_messages"("branch_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "contact_messages_created_at_idx" ON "contact_messages"("created_at");

-- CreateIndex
CREATE INDEX "contact_message_status_changes_contact_message_id_created_a_idx" ON "contact_message_status_changes"("contact_message_id", "created_at");

-- AddForeignKey
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_message_status_changes" ADD CONSTRAINT "contact_message_status_changes_contact_message_id_fkey" FOREIGN KEY ("contact_message_id") REFERENCES "contact_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_message_status_changes" ADD CONSTRAINT "contact_message_status_changes_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

