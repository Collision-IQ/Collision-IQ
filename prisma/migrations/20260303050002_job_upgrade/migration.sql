/*
  Warnings:

  - Added the required column `type` to the `SyncJob` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "SyncJob" ADD COLUMN     "cursor" JSONB,
ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "lockedBy" TEXT,
ADD COLUMN     "stage" TEXT,
ADD COLUMN     "type" TEXT NOT NULL,
ALTER COLUMN "egnytePath" DROP NOT NULL;
