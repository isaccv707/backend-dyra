/*
  Warnings:

  - Made the column `serviceId` on table `studies` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "studies" DROP CONSTRAINT "studies_serviceId_fkey";

-- AlterTable
ALTER TABLE "studies" ALTER COLUMN "serviceId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "studies" ADD CONSTRAINT "studies_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
