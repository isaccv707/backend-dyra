/*
  Warnings:

  - A unique constraint covering the columns `[slug]` on the table `Study` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `slug` to the `Study` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Study" ADD COLUMN     "slug" TEXT NOT NULL,
ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE UNIQUE INDEX "Study_slug_key" ON "Study"("slug");
