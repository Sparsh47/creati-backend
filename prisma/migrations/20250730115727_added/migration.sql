/*
  Warnings:

  - Added the required column `prompt` to the `Designs` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "Type" AS ENUM ('PUBLIC', 'PRIVATE');

-- AlterTable
ALTER TABLE "Designs" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "prompt" TEXT NOT NULL,
ADD COLUMN     "visibility" "Type" NOT NULL DEFAULT 'PUBLIC';
