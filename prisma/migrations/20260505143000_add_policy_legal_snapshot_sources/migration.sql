ALTER TABLE "PolicyLegalReviewSnapshot"
ADD COLUMN IF NOT EXISTS "regulation_sources_used" JSONB NOT NULL DEFAULT '[]'::jsonb;
