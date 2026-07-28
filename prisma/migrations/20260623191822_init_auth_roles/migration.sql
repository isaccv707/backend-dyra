/*
  Warnings:

  - You are about to drop the column `PriceSheetId` on the `study_on_price_list` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[studyId,priceSheetId]` on the table `study_on_price_list` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `name` to the `studies` table without a default value. This is not possible if the table is not empty.
  - Added the required column `priceSheetId` to the `study_on_price_list` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "study_on_price_list" DROP CONSTRAINT "study_on_price_list_PriceSheetId_fkey";

-- DropIndex
DROP INDEX "study_on_price_list_studyId_PriceSheetId_key";

-- AlterTable
ALTER TABLE "studies" ADD COLUMN     "name" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "study_on_price_list" DROP COLUMN "PriceSheetId",
ADD COLUMN     "priceSheetId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolesOnPermissions" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolesOnPermissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_action_key" ON "Permission"("action");

-- CreateIndex
CREATE UNIQUE INDEX "study_on_price_list_studyId_priceSheetId_key" ON "study_on_price_list"("studyId", "priceSheetId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolesOnPermissions" ADD CONSTRAINT "RolesOnPermissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolesOnPermissions" ADD CONSTRAINT "RolesOnPermissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_on_price_list" ADD CONSTRAINT "study_on_price_list_priceSheetId_fkey" FOREIGN KEY ("priceSheetId") REFERENCES "price_sheets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
