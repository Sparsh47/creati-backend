-- CreateTable
CREATE TABLE "Designs" (
    "id" TEXT NOT NULL,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "Designs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_DesignsToUser" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_DesignsToUser_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_DesignsToUser_B_index" ON "_DesignsToUser"("B");

-- AddForeignKey
ALTER TABLE "_DesignsToUser" ADD CONSTRAINT "_DesignsToUser_A_fkey" FOREIGN KEY ("A") REFERENCES "Designs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DesignsToUser" ADD CONSTRAINT "_DesignsToUser_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
