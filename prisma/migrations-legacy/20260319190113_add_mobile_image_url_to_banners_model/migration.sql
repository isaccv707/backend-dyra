/*
  Warnings:

  - You are about to drop the column `imageUrl` on the `banners` table. All the data in the column will be lost.
  - Added the required column `image_url` to the `banners` table without a default value. This is not possible if the table is not empty.
  - Added the required column `mobile_image_url` to the `banners` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "banners" DROP COLUMN "imageUrl",
ADD COLUMN     "image_url" TEXT NOT NULL,
ADD COLUMN     "mobile_image_url" TEXT NOT NULL;
