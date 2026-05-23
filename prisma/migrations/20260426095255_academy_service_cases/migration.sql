-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AcademyServiceType') THEN
    CREATE TYPE "AcademyServiceType" AS ENUM (
      'REKEY_ESTIMATING',
      'LEGAL_ASSIST',
      'ACV_REVIEW',
      'APPRAISAL',
      'APPRAISAL_CLAUSE',
      'VALUE_DISPUTE',
      'DIMINISHED_VALUE'
    );
  END IF;
END $$;

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AcademyCaseStatus') THEN
    CREATE TYPE "AcademyCaseStatus" AS ENUM (
      'PENDING_INTAKE',
      'INTAKE_RECEIVED',
      'IN_REVIEW',
      'IN_PROGRESS',
      'COMPLETED',
      'CANCELED'
    );
  END IF;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "AcademyServiceCase" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "serviceType" "AcademyServiceType" NOT NULL,
  "status" "AcademyCaseStatus" NOT NULL DEFAULT 'PENDING_INTAKE',
  "claimId" TEXT,
  "stripeSessionId" TEXT,
  "stripePaymentIntentId" TEXT,
  "amountPaid" INTEGER,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AcademyServiceCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AcademyServiceCase_stripeSessionId_key"
ON "AcademyServiceCase"("stripeSessionId");

CREATE INDEX IF NOT EXISTS "AcademyServiceCase_userId_idx"
ON "AcademyServiceCase"("userId");

CREATE INDEX IF NOT EXISTS "AcademyServiceCase_status_idx"
ON "AcademyServiceCase"("status");

CREATE INDEX IF NOT EXISTS "AcademyServiceCase_serviceType_idx"
ON "AcademyServiceCase"("serviceType");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'AcademyServiceCase_userId_fkey'
  ) THEN
    ALTER TABLE "AcademyServiceCase"
    ADD CONSTRAINT "AcademyServiceCase_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
