/*
  Warnings:

  - You are about to drop the column `planType` on the `User` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[userId]` on the table `Subscriptions` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `planType` to the `Subscriptions` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Subscriptions_stripeSubscriptionId_key";

-- AlterTable
ALTER TABLE "Subscriptions" ADD COLUMN     "planType" "PlanType" NOT NULL,
ALTER COLUMN "stripeSubscriptionId" DROP NOT NULL,
ALTER COLUMN "stripePriceId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "planType";

-- CreateIndex
CREATE UNIQUE INDEX "Subscriptions_userId_key" ON "Subscriptions"("userId");
