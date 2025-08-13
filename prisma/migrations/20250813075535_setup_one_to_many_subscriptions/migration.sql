/*
  Warnings:

  - A unique constraint covering the columns `[stripeSubscriptionId]` on the table `Subscriptions` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,planType,status]` on the table `Subscriptions` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Subscriptions_userId_key";

-- CreateIndex
CREATE UNIQUE INDEX "Subscriptions_stripeSubscriptionId_key" ON "Subscriptions"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "Subscriptions_userId_status_idx" ON "Subscriptions"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Subscriptions_userId_planType_status_key" ON "Subscriptions"("userId", "planType", "status");
