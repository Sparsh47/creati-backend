/*
  Warnings:

  - Added the required column `title` to the `Designs` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Designs" ADD COLUMN     "title" TEXT NOT NULL;
