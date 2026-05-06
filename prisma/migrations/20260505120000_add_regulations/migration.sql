CREATE TABLE IF NOT EXISTS "Regulation" (
  "id" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "rule" TEXT NOT NULL,
  "citation" TEXT NOT NULL,
  "source_url" TEXT,
  "source_name" TEXT,
  "applicability" TEXT,
  "severity" TEXT,
  "effective_date" TIMESTAMP(3),
  "retrieved_at" TIMESTAMP(3),
  "verified_by" TEXT,
  "notes" TEXT,

  CONSTRAINT "Regulation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Regulation" ADD COLUMN IF NOT EXISTS "source_name" TEXT;
ALTER TABLE "Regulation" ADD COLUMN IF NOT EXISTS "retrieved_at" TIMESTAMP(3);
ALTER TABLE "Regulation" ADD COLUMN IF NOT EXISTS "verified_by" TEXT;
ALTER TABLE "Regulation" ADD COLUMN IF NOT EXISTS "notes" TEXT;

CREATE TABLE IF NOT EXISTS "PolicyLegalRegulationAccessLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "state" TEXT,
  "requestId" TEXT,
  "cacheStatus" TEXT,
  "status" INTEGER NOT NULL,
  "totalCount" INTEGER NOT NULL DEFAULT 0,
  "verifiedCount" INTEGER NOT NULL DEFAULT 0,
  "placeholderCount" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PolicyLegalRegulationAccessLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PolicyLegalRegulationAccessLog_state_idx" ON "PolicyLegalRegulationAccessLog"("state");
CREATE INDEX IF NOT EXISTS "PolicyLegalRegulationAccessLog_userId_idx" ON "PolicyLegalRegulationAccessLog"("userId");
CREATE INDEX IF NOT EXISTS "PolicyLegalRegulationAccessLog_created_at_idx" ON "PolicyLegalRegulationAccessLog"("created_at");

CREATE TABLE IF NOT EXISTS "PolicyLegalReviewSnapshot" (
  "id" TEXT NOT NULL,
  "case_id" TEXT,
  "claim_id" TEXT,
  "claim_state" TEXT,
  "regulation_ids_used" JSONB NOT NULL,
  "regulation_sources_used" JSONB NOT NULL,
  "citations_used" JSONB NOT NULL,
  "oem_sources_used" JSONB NOT NULL,
  "carrier_sources_used" JSONB NOT NULL,
  "placeholder_citations" JSONB NOT NULL,
  "policy_legal_confidence_score" INTEGER NOT NULL,
  "generated_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PolicyLegalReviewSnapshot_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PolicyLegalReviewSnapshot" ADD COLUMN IF NOT EXISTS "regulation_sources_used" JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS "PolicyLegalReviewSnapshot_case_id_idx" ON "PolicyLegalReviewSnapshot"("case_id");
CREATE INDEX IF NOT EXISTS "PolicyLegalReviewSnapshot_claim_id_idx" ON "PolicyLegalReviewSnapshot"("claim_id");
CREATE INDEX IF NOT EXISTS "PolicyLegalReviewSnapshot_claim_state_idx" ON "PolicyLegalReviewSnapshot"("claim_state");
CREATE INDEX IF NOT EXISTS "PolicyLegalReviewSnapshot_generated_at_idx" ON "PolicyLegalReviewSnapshot"("generated_at");
