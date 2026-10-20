/*
  Warnings:

  - Added the required column `urlResults` to the `branches` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "urlResults" TEXT NOT NULL;
