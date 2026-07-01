import { sql } from "@/lib/db";
import type { RetrievedChunk } from "@/lib/types";
import { getChunkSourceColumn } from "./chunkSourceColumn";
import { getStoredEmbeddingDimension } from "./embeddingDimension";

export async function searchChunks(
  embedding: number[],
  limit = 5
): Promise<RetrievedChunk[]> {
  // No usable query embedding (e.g. VOYAGE_API_KEY missing) — let the caller's
  // keyword search carry retrieval instead of running an empty vector query.
  if (!embedding.length) {
    return [];
  }

  // If the query embedding dimension does not match the stored vectors (e.g.
  // after an embedding-provider change), pgvector's distance operator throws.
  // Skip vector search and degrade to keyword search rather than crashing.
  const storedDimension = await getStoredEmbeddingDimension();
  if (storedDimension !== null && embedding.length !== storedDimension) {
    console.warn(
      "[rag/searchChunks] embedding dimension mismatch — skipping vector search (keyword fallback active)",
      { queryDimension: embedding.length, storedDimension }
    );
    return [];
  }

  const safeLimit = Math.max(1, Math.min(limit, 20));
  const sourceColumn = await getChunkSourceColumn();
  const sourceFilter = sourceColumn
    ? `AND ${sourceColumn} IN ('google', 'onedrive1', 'onedrive2')`
    : "";
  const queryVector = JSON.stringify(embedding);

  try {
    const result = await sql<{
      id: string;
      content: string;
      file_id: string;
      distance: string | number;
    }>([
      `
      SELECT
        id,
        content,
        file_id,
        (embedding <-> `,
      `::vector) AS distance
      FROM document_chunks
      WHERE embedding IS NOT NULL
        ${sourceFilter}
      ORDER BY distance ASC
      LIMIT `,
      `
    `] as unknown as TemplateStringsArray,
      queryVector,
      safeLimit
    );

    return result.rows.map((row: (typeof result.rows)[number]) => ({
      id: row.id,
      content: row.content,
      file_id: row.file_id,
      distance: Number(row.distance),
    }));
  } catch (error) {
    // Safety net: never let a vector-search failure (e.g. an undetected
    // dimension mismatch) abort retrieval — the caller's keyword search runs.
    console.warn("[rag/searchChunks] vector search failed — falling back to keyword search", {
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
