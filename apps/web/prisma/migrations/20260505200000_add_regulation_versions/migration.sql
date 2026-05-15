CREATE TABLE IF NOT EXISTS "RegulationVersion" (
  "id" TEXT NOT NULL,
  "regulation_id" TEXT NOT NULL,
  "jurisdiction" TEXT NOT NULL,
  "effective_date" TIMESTAMP(3),
  "superseded_date" TIMESTAMP(3),
  "source_publication_date" TIMESTAMP(3),
  "version_hash" TEXT NOT NULL,
  "verification_status" TEXT NOT NULL,
  "citation_source" TEXT NOT NULL,
  "retrieval_timestamp" TIMESTAMP(3) NOT NULL,
  "snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RegulationVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RegulationVersion_regulation_id_version_hash_key"
ON "RegulationVersion"("regulation_id", "version_hash");

CREATE INDEX IF NOT EXISTS "RegulationVersion_regulation_id_idx"
ON "RegulationVersion"("regulation_id");

CREATE INDEX IF NOT EXISTS "RegulationVersion_jurisdiction_idx"
ON "RegulationVersion"("jurisdiction");

CREATE INDEX IF NOT EXISTS "RegulationVersion_effective_date_idx"
ON "RegulationVersion"("effective_date");

CREATE INDEX IF NOT EXISTS "RegulationVersion_retrieval_timestamp_idx"
ON "RegulationVersion"("retrieval_timestamp");
