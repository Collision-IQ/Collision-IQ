import { prisma } from "@/lib/prisma";

let cachedDimension: number | null | undefined;

/**
 * Dimension of the stored document_chunks.embedding vectors, detected once from
 * a sample row. Returns null when it can't be determined (no rows / no pgvector).
 *
 * Used to decide whether a query embedding is compatible with the stored
 * vectors. After an embedding-provider change (e.g. OpenAI 1536-dim ->
 * Voyage voyage-3-large 1024-dim) the stored corpus and new query embeddings
 * differ in dimension; pgvector's distance operator throws on a mismatch, so we
 * detect it and fall back to keyword search instead of crashing retrieval.
 */
export async function getStoredEmbeddingDimension(): Promise<number | null> {
  if (cachedDimension !== undefined) {
    return cachedDimension;
  }
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ dim: number | string | null }>>(
      `SELECT vector_dims(embedding) AS dim
       FROM document_chunks
       WHERE embedding IS NOT NULL
       LIMIT 1`
    );
    const raw = rows[0]?.dim;
    const dim = typeof raw === "number" ? raw : raw != null ? Number(raw) : NaN;
    cachedDimension = Number.isFinite(dim) && dim > 0 ? dim : null;
  } catch {
    // Table/extension missing or otherwise unavailable — treat as unknown.
    cachedDimension = null;
  }
  return cachedDimension;
}

/** Test/maintenance hook to force re-detection (e.g. after a re-ingest). */
export function resetStoredEmbeddingDimensionCache(): void {
  cachedDimension = undefined;
}
