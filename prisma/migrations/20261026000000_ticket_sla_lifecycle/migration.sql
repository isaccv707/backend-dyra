-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TicketNotificationKind" ADD VALUE 'SLA_WARNING';
ALTER TYPE "TicketNotificationKind" ADD VALUE 'ESCALATION';

-- AlterTable
ALTER TABLE "ticket_comments" ALTER COLUMN "author_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ticket_events" ALTER COLUMN "actor_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "escalated_at" TIMESTAMP(3),
ADD COLUMN     "sla_warned_at" TIMESTAMP(3);
