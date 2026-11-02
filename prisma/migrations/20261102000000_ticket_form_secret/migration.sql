-- AlterTable
ALTER TABLE "ticket_forms" ADD COLUMN     "encrypted_secret" TEXT,
ADD COLUMN     "has_secret" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "secret_purged_at" TIMESTAMP(3);

-- The TeamViewer password never lives in the JSON data: drop any plain-text copy.
UPDATE "ticket_forms"
SET "data" = "data" - 'teamViewerPassword'
WHERE "type" = 'SOFTWARE_REMOTE' AND "data" ? 'teamViewerPassword';
