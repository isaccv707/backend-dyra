/*
  Warnings:

  - You are about to drop the column `price` on the `studies` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "studies" DROP COLUMN "price";

-- CreateTable
CREATE TABLE "study_prices" (
    "id" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "showPrice" BOOLEAN NOT NULL DEFAULT true,
    "studyId" TEXT NOT NULL,
    "stateId" INTEGER NOT NULL,

    CONSTRAINT "study_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "study_prices_studyId_stateId_key" ON "study_prices"("studyId", "stateId");

-- AddForeignKey
ALTER TABLE "study_prices" ADD CONSTRAINT "study_prices_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_prices" ADD CONSTRAINT "study_prices_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "states"("id") ON DELETE CASCADE ON UPDATE CASCADE;
