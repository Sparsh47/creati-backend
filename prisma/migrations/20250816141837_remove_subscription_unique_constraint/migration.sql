/*
  Warnings:

  - A unique constraint covering the columns `[userId,stripeSubscriptionId]` on the table `Subscriptions` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Subscriptions_userId_planType_status_key";

-- CreateIndex
CREATE UNIQUE INDEX "Subscriptions_userId_stripeSubscriptionId_key" ON "Subscriptions"("userId", "stripeSubscriptionId");
