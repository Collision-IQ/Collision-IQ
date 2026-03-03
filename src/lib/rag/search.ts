import { prisma } from "@/lib/prisma";

type ChunkMatch = {
  text: string;
  drive_path: string | null;
  similarity: number | null;
};

/**
 * Converts embedding array into pgvector literal: '[1,2,3]'
 * Only numbers are allowed.
 */
function toVectorLiteral(embedding: number[]) {
  if (!Array.isArray(embedding) || embedding.length === 0) return null;

  const safe = embedding
    .map((n) => (Number.isFinite(n) ? n : 0))
    .join(",");

  return `[${safe}]`;
}

export async function searchSimilarChunks(
  embedding: number[],
  limit = 5
): Promise<ChunkMatch[]> {
  const vec = toVectorLiteral(embedding);
  if (!vec) return [];

  // NOTE: Prisma doesn't natively parameterize pgvector literals well,
  // so we keep the vector string fully numeric + server-generated.
  const rows = (await prisma.$queryRawUnsafe(`
    SELECT
      text,
      drive_path,
      1 - (embedding <=> '${vec}') AS similarity
    FROM document_chunks
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> '${vec}'
    LIMIT ${Math.max(1, Math.min(limit, 20))};
  `)) as ChunkMatch[];

  return rows ?? [];
}