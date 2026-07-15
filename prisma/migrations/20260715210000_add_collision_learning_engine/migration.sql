-- CreateEnum
CREATE TYPE "LearningItemStatus" AS ENUM ('DRAFT', 'VERIFIED', 'PROMOTED', 'RETIRED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "LearningMode" AS ENUM ('ACTIVE_RECALL', 'FEYNMAN', 'CONTRAST', 'INTERLEAVED_CASE', 'FULL_REPORT', 'HOLDOUT');

-- CreateEnum
CREATE TYPE "BenchmarkRunKind" AS ENUM ('BASELINE', 'WEEKLY', 'HOLDOUT', 'CAPSTONE');

-- CreateTable
CREATE TABLE "CollisionLearningItem" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "subdomain" TEXT,
    "objective" TEXT NOT NULL,
    "skillTags" TEXT[],
    "prompt" TEXT NOT NULL,
    "goldAnswer" JSONB NOT NULL,
    "sourceRefs" JSONB NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "authorityTier" INTEGER NOT NULL,
    "oem" TEXT,
    "jurisdiction" TEXT,
    "vehicleScope" JSONB,
    "safetyCritical" BOOLEAN NOT NULL DEFAULT false,
    "holdout" BOOLEAN NOT NULL DEFAULT false,
    "status" "LearningItemStatus" NOT NULL DEFAULT 'DRAFT',
    "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "intervalDays" INTEGER NOT NULL DEFAULT 0,
    "ease" DOUBLE PRECISION NOT NULL DEFAULT 2.3,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollisionLearningItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollisionLearningAttempt" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "mode" "LearningMode" NOT NULL,
    "modelName" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "grade" INTEGER NOT NULL,
    "factualAccuracy" DOUBLE PRECISION NOT NULL,
    "evidenceCoverage" DOUBLE PRECISION NOT NULL,
    "citationFidelity" DOUBLE PRECISION NOT NULL,
    "safetyRecall" DOUBLE PRECISION NOT NULL,
    "calibrationScore" DOUBLE PRECISION NOT NULL,
    "unsupportedClaimRate" DOUBLE PRECISION NOT NULL,
    "evaluatorVersion" TEXT NOT NULL,
    "errorCodes" TEXT[],
    "benchmarkRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollisionLearningAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollisionLearningPromotion" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "benchmarkRunId" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "CollisionLearningPromotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollisionLearningError" (
    "id" TEXT NOT NULL,
    "itemId" TEXT,
    "domain" TEXT NOT NULL,
    "errorCode" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "CollisionLearningError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollisionBenchmarkRun" (
    "id" TEXT NOT NULL,
    "kind" "BenchmarkRunKind" NOT NULL,
    "label" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "frozen" BOOLEAN NOT NULL DEFAULT false,
    "metrics" JSONB,
    "notes" TEXT,

    CONSTRAINT "CollisionBenchmarkRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollisionBenchmarkResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "mode" "LearningMode" NOT NULL,
    "grade" INTEGER NOT NULL,
    "metrics" JSONB NOT NULL,
    "regression" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollisionBenchmarkResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CollisionLearningItem_slug_key" ON "CollisionLearningItem"("slug");

-- CreateIndex
CREATE INDEX "CollisionLearningItem_status_dueAt_idx" ON "CollisionLearningItem"("status", "dueAt");

-- CreateIndex
CREATE INDEX "CollisionLearningItem_domain_dueAt_idx" ON "CollisionLearningItem"("domain", "dueAt");

-- CreateIndex
CREATE INDEX "CollisionLearningItem_oem_jurisdiction_idx" ON "CollisionLearningItem"("oem", "jurisdiction");

-- CreateIndex
CREATE INDEX "CollisionLearningItem_holdout_status_idx" ON "CollisionLearningItem"("holdout", "status");

-- CreateIndex
CREATE INDEX "CollisionLearningAttempt_itemId_createdAt_idx" ON "CollisionLearningAttempt"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "CollisionLearningAttempt_mode_createdAt_idx" ON "CollisionLearningAttempt"("mode", "createdAt");

-- CreateIndex
CREATE INDEX "CollisionLearningAttempt_benchmarkRunId_idx" ON "CollisionLearningAttempt"("benchmarkRunId");

-- CreateIndex
CREATE INDEX "CollisionLearningPromotion_itemId_approvedAt_idx" ON "CollisionLearningPromotion"("itemId", "approvedAt");

-- CreateIndex
CREATE INDEX "CollisionLearningError_severity_lastSeenAt_idx" ON "CollisionLearningError"("severity", "lastSeenAt");

-- CreateIndex
CREATE INDEX "CollisionLearningError_domain_errorCode_idx" ON "CollisionLearningError"("domain", "errorCode");

-- CreateIndex
CREATE INDEX "CollisionBenchmarkRun_kind_startedAt_idx" ON "CollisionBenchmarkRun"("kind", "startedAt");

-- CreateIndex
CREATE INDEX "CollisionBenchmarkResult_runId_itemId_idx" ON "CollisionBenchmarkResult"("runId", "itemId");

-- CreateIndex
CREATE INDEX "CollisionBenchmarkResult_itemId_createdAt_idx" ON "CollisionBenchmarkResult"("itemId", "createdAt");

-- AddForeignKey
ALTER TABLE "CollisionLearningAttempt" ADD CONSTRAINT "CollisionLearningAttempt_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CollisionLearningItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollisionBenchmarkResult" ADD CONSTRAINT "CollisionBenchmarkResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CollisionBenchmarkRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

