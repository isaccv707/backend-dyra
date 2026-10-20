/*
  Warnings:

  - You are about to drop the column `name` on the `studies` table. All the data in the column will be lost.
  - You are about to drop the `study_prices` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "study_prices" DROP CONSTRAINT "study_prices_stateId_fkey";

-- DropForeignKey
ALTER TABLE "study_prices" DROP CONSTRAINT "study_prices_studyId_fkey";

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "price_sheet_id" TEXT;

-- AlterTable
ALTER TABLE "studies" DROP COLUMN "name";

-- DropTable
DROP TABLE "study_prices";

-- CreateTable
CREATE TABLE "price_sheets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "price_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_on_price_list" (
    "id" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "showPrice" BOOLEAN NOT NULL DEFAULT true,
    "studyId" TEXT NOT NULL,
    "PriceSheetId" TEXT NOT NULL,

    CONSTRAINT "study_on_price_list_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "study_on_price_list_studyId_PriceSheetId_key" ON "study_on_price_list"("studyId", "PriceSheetId");

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_price_sheet_id_fkey" FOREIGN KEY ("price_sheet_id") REFERENCES "price_sheets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_on_price_list" ADD CONSTRAINT "study_on_price_list_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "studies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_on_price_list" ADD CONSTRAINT "study_on_price_list_PriceSheetId_fkey" FOREIGN KEY ("PriceSheetId") REFERENCES "price_sheets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
