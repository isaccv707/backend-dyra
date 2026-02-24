/*
  Warnings:

  - A unique constraint covering the columns `[nameKey]` on the table `Author` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `nameKey` to the `Author` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Author" ADD COLUMN     "nameKey" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Author_nameKey_key" ON "Author"("nameKey");
