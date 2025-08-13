-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('FREE', 'PLUS', 'PRO_PLUS');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "planType" "PlanType" NOT NULL DEFAULT 'FREE';
