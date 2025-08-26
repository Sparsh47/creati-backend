/*
  Warnings:

  - The values [CANCELED] on the enum `PaymentStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `reievedAt` on the `WebhookEvents` table. All the data in the column will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "PaymentStatus_new" AS ENUM ('ACTIVE', 'CANCELLED', 'PAST_DUE', 'INCOMPLETE', 'EXPIRED');
ALTER TABLE "Subscriptions" ALTER COLUMN "status" TYPE "PaymentStatus_new" USING ("status"::text::"PaymentStatus_new");
ALTER TYPE "PaymentStatus" RENAME TO "PaymentStatus_old";
ALTER TYPE "PaymentStatus_new" RENAME TO "PaymentStatus";
DROP TYPE "PaymentStatus_old";
COMMIT;

-- DropIndex
DROP INDEX "Subscriptions_userId_status_idx";

-- AlterTable
ALTER TABLE "Subscriptions" ADD COLUMN     "cancelAtPeriodEnd" BOOLEAN DEFAULT false,
ADD COLUMN     "currentPeriodStart" TIMESTAMP(3),
ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "lastPaymentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WebhookEvents" DROP COLUMN "reievedAt",
ADD COLUMN     "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Subscriptions_userId_idx" ON "Subscriptions"("userId");

-- CreateIndex
CREATE INDEX "Subscriptions_status_idx" ON "Subscriptions"("status");

-- CreateIndex
CREATE INDEX "Subscriptions_stripeSubscriptionId_idx" ON "Subscriptions"("stripeSubscriptionId");
