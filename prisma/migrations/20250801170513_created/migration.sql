/*
  Warnings:

  - You are about to drop the column `images` on the `Designs` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Designs" DROP COLUMN "images";

-- CreateTable
CREATE TABLE "Images" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secureUrl" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "designsId" TEXT,

    CONSTRAINT "Images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Images_publicId_key" ON "Images"("publicId");

-- AddForeignKey
ALTER TABLE "Images" ADD CONSTRAINT "Images_designsId_fkey" FOREIGN KEY ("designsId") REFERENCES "Designs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
