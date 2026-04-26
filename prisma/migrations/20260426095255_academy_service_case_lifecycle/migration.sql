/*
  Warnings:

  - You are about to drop the column `amountPaid` on the `AcademyServiceCase` table. All the data in the column will be lost.
  - You are about to drop the column `notes` on the `AcademyServiceCase` table. All the data in the column will be lost.
  - The `status` column on the `AcademyServiceCase` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Changed the type of `serviceType` on the `AcademyServiceCase` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "AcademyServiceCaseStatus" AS ENUM ('PENDING_INTAKE', 'IN_REVIEW', 'IN_PROGRESS', 'AWAITING_INFO', 'COMPLETE', 'CANCELLED');

-- DropForeignKey
ALTER TABLE "AcademyServiceCase" DROP CONSTRAINT "AcademyServiceCase_userId_fkey";

-- AlterTable
ALTER TABLE "AcademyServiceCase" DROP COLUMN "amountPaid",
DROP COLUMN "notes",
ADD COLUMN     "intakeNotes" TEXT,
ADD COLUMN     "internalNotes" TEXT,
ADD COLUMN     "lastUpdate" TEXT,
ALTER COLUMN "userId" DROP NOT NULL,
DROP COLUMN "serviceType",
ADD COLUMN     "serviceType" TEXT NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "AcademyServiceCaseStatus" NOT NULL DEFAULT 'PENDING_INTAKE';

-- DropEnum
DROP TYPE "AcademyCaseStatus";

-- DropEnum
DROP TYPE "AcademyServiceType";

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "response" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" SERIAL NOT NULL,
    "content" TEXT,
    "embedding" vector,
    "file_id" TEXT,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drive_watch_state" (
    "id" TEXT NOT NULL,
    "last_page_token" TEXT NOT NULL,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drive_watch_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rag_chunks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "drive_path" TEXT,
    "text" TEXT,
    "embedding" vector,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rag_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IdempotencyKey_userId_action_idx" ON "IdempotencyKey"("userId", "action");

-- CreateIndex
CREATE INDEX "AcademyServiceCase_claimId_idx" ON "AcademyServiceCase"("claimId");

-- CreateIndex
CREATE INDEX "AcademyServiceCase_status_idx" ON "AcademyServiceCase"("status");

-- CreateIndex
CREATE INDEX "AcademyServiceCase_serviceType_idx" ON "AcademyServiceCase"("serviceType");

-- CreateIndex
CREATE INDEX "UsageCounter_kind_idx" ON "UsageCounter"("kind");

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
