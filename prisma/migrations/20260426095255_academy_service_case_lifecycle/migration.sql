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

-- CreateIndex
CREATE INDEX "AcademyServiceCase_claimId_idx" ON "AcademyServiceCase"("claimId");

-- CreateIndex
CREATE INDEX "AcademyServiceCase_status_idx" ON "AcademyServiceCase"("status");

-- CreateIndex
CREATE INDEX "AcademyServiceCase_serviceType_idx" ON "AcademyServiceCase"("serviceType");
