import { prisma } from "@/lib/prisma";

type ChunkMatch = {
  text: string;
  drive_path: string | null;
  similarity: number | null;
};

export async function keywordSearch(
  query: string,
  limit = 5
): Promise<ChunkMatch[]> {

  const rows = await prisma.$queryRawUnsafe<ChunkMatch[]>(`
    SELECT
      text,
      drive_path,
      NULL AS similarity
    FROM document_chunks
    WHERE to_tsvector('english', text) @@ plainto_tsquery($1)
    LIMIT $2
  `, query, limit);

  return rows ?? [];
}