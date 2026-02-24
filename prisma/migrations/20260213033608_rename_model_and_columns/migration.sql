/*
  Warnings:

  - You are about to drop the column `autorId` on the `Post` table. All the data in the column will be lost.
  - You are about to drop the `Autor` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Post" DROP CONSTRAINT "Post_autorId_fkey";

-- AlterTable
ALTER TABLE "Post" DROP COLUMN "autorId",
ADD COLUMN     "authorId" TEXT;

-- DropTable
DROP TABLE "Autor";

-- CreateTable
CREATE TABLE "Athor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatar" TEXT,
    "bio" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Athor_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Athor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
