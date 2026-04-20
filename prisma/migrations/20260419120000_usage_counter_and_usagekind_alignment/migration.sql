-- Ensure UsageKind contains all usage events used by application code.
ALTER TYPE "UsageKind" ADD VALUE IF NOT EXISTS 'FILE_UPLOAD';
ALTER TYPE "UsageKind" ADD VALUE IF NOT EXISTS 'REPORT_EXPORT';
ALTER TYPE "UsageKind" ADD VALUE IF NOT EXISTS 'CHAT_EXPORT';

-- Create UsageCounter for fast per-user usage counters.
CREATE TABLE IF NOT EXISTS "UsageCounter" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" "UsageKind" NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

-- Enforce one counter row per user and usage kind.
CREATE UNIQUE INDEX IF NOT EXISTS "UsageCounter_userId_kind_key"
ON "UsageCounter"("userId", "kind");

-- Ensure referential integrity to User.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'UsageCounter_userId_fkey'
  ) THEN
    ALTER TABLE "UsageCounter"
    ADD CONSTRAINT "UsageCounter_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION update_usage_counter_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS set_updated_at ON "UsageCounter";

CREATE TRIGGER set_updated_at
BEFORE UPDATE ON "UsageCounter"
FOR EACH ROW
EXECUTE PROCEDURE update_usage_counter_updated_at();
