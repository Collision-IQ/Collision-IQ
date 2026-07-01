# RAG re-embedding (OpenAI 1536 → Voyage 1024)

The `document_chunks` corpus was embedded with OpenAI `text-embedding-3-small`
(1536-dim). Queries now embed with Voyage `voyage-3-large` (1024-dim), so
pgvector's distance operator can't compare them and vector search is skipped
(keyword search still runs — see `src/lib/rag/searchChunks.ts`). To restore
semantic search, re-embed the corpus at 1024-dim.

This repopulates embeddings from the **existing `content`** column — no
Drive/OneDrive re-fetch or re-chunking needed.

## Steps

1. **Back up** (recommended): snapshot the DB or at least `document_chunks`.

2. **Migrate the column** — clears old vectors and retypes to `vector(1024)`.
   Keyword search keeps working throughout.
   ```bash
   psql "$DATABASE_URL" -f scripts/rag/01-migrate-embedding-1024.sql
   ```
   (Inspect the current column type + index name with the commented queries at
   the top first, and adjust the `DROP INDEX` name if yours differs.)

3. **Re-embed** — reads `DATABASE_URL` + `VOYAGE_API_KEY` from `.env.local`/`.env`.
   Idempotent and resumable (only touches rows with `embedding IS NULL`); safe to
   re-run after an interrupt. Costs Voyage credits proportional to corpus size.
   ```bash
   node scripts/rag/reembed-chunks-voyage.cjs
   # tune with REEMBED_BATCH (default 100) and REEMBED_DELAY_MS (default 200)
   ```

4. **Recreate the ANN index** on the populated table (see step 4 in the SQL
   file — HNSW for pgvector ≥ 0.5, else IVFFlat). Vector search is correct
   without it; the index is only for speed.

5. **Verify**: `searchChunks` stops logging the dimension-mismatch warning and
   `getStoredEmbeddingDimension()` now reports 1024. A chat/analysis turn should
   pull semantic hits again.

## Notes

- The app never crashes during this: `searchChunks` degrades to keyword-only
  while dimensions differ, and resumes vector search once they match.
- To change the Voyage model, set `VOYAGE_EMBED_MODEL`; keep the column
  dimension in step 2 in sync with that model's output dimension.
