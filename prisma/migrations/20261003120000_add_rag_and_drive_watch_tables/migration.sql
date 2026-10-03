-- Tables the app has used for Drive RAG retrieval and Drive change tracking
-- that no earlier migration created (they were made outside migrations), plus
-- two column defaults that schema.prisma declares and no migration set.
--
-- Written to be safe on a database that already has them: an existing
-- extension or table is left exactly as it is. On a fresh database (CI, a new
-- environment) it creates them in the shape src/lib/rag reads and writes.

CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE IF NOT EXISTS "document_chunks" (
    "id" TEXT NOT NULL,
    "source" TEXT,
    "file_id" TEXT,
    "chunk_index" INTEGER,
    "content" TEXT,
    "embedding" vector,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "system" TEXT,
    "component" TEXT,
    "procedure" TEXT,
    "doc_type" TEXT,
    "authority" DOUBLE PRECISION,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "rag_chunks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "drive_path" TEXT,
    "text" TEXT,
    "embedding" vector,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rag_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "drive_watch_state" (
    "id" TEXT NOT NULL,
    "last_page_token" TEXT NOT NULL,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drive_watch_state_pkey" PRIMARY KEY ("id")
);

-- AlterTable (defaults only; existing rows are unchanged)
ALTER TABLE "PolicyLegalReviewSnapshot" ALTER COLUMN "regulation_sources_used" SET DEFAULT '[]';

-- AlterTable (defaults only; existing rows are unchanged)
ALTER TABLE "ReportSend" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
