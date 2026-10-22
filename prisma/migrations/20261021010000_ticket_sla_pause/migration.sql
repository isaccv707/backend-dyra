-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "on_hold_since" TIMESTAMP(3),
ADD COLUMN     "sla_paused_seconds" INTEGER NOT NULL DEFAULT 0;


-- Tickets already on hold: the pause counts from their last update (best estimate).
UPDATE "tickets" SET "on_hold_since" = "updatedAt" WHERE "status" = 'ON_HOLD';
