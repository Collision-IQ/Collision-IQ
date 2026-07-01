-- RAG embedding migration: OpenAI text-embedding-3-small (1536-dim)
--                          -> Voyage voyage-3-large (1024-dim).
--
-- Run this ONCE against the target database BEFORE running
-- scripts/rag/reembed-chunks-voyage.cjs.
--
-- Keyword search keeps working the whole time: searchChunks skips the vector
-- query while the stored dimension does not match the query dimension.
--
-- IMPORTANT: this clears every stored embedding. The re-embed script then
-- repopulates them from the existing document_chunks.content (no Drive/OneDrive
-- re-fetch needed).

-- 0. (informational) Inspect the current column type + vector index name so you
--    can confirm the dimension and adjust the DROP INDEX name below if needed:
--
--    SELECT format_type(a.atttypid, a.atttypmod) AS embedding_type
--    FROM pg_attribute a
--    WHERE a.attrelid = 'document_chunks'::regclass AND a.attname = 'embedding';
--
--    SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'document_chunks';

BEGIN;

-- 1. Clear old 1536-dim vectors (a 1536 vector cannot be cast to 1024).
UPDATE document_chunks SET embedding = NULL;

-- 2. Drop the dimension-bound ANN index (rename to match step 0 if different).
DROP INDEX IF EXISTS document_chunks_embedding_idx;

-- 3. Retype the column to 1024 dimensions.
ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector(1024);

COMMIT;

-- 4. Recreate the ANN index AFTER re-embedding (build it on populated data for a
--    better index). Run this once the re-embed script has finished.
--
--    searchChunks uses the L2 distance operator (<->), so use vector_l2_ops.
--
--    pgvector >= 0.5.0 (recommended):
--      CREATE INDEX document_chunks_embedding_idx
--        ON document_chunks USING hnsw (embedding vector_l2_ops);
--
--    Older pgvector (ivfflat; pick lists ~= sqrt(rowcount)):
--      CREATE INDEX document_chunks_embedding_idx
--        ON document_chunks USING ivfflat (embedding vector_l2_ops) WITH (lists = 100);
--
--    (Vector search is correct without an index — the index is only for speed.)
