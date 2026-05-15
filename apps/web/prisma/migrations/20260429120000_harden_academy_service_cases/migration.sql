ALTER TABLE "AcademyServiceCase"
  ADD COLUMN IF NOT EXISTS "stripeEventId" TEXT,
  ADD COLUMN IF NOT EXISTS "attachmentIds" JSONB,
  ADD COLUMN IF NOT EXISTS "reviewSnapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "checkoutMetadata" JSONB;

