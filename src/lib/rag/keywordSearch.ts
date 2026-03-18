import { prisma } from "@/lib/prisma";

import type { RetrievedChunk } from "@/lib/types";

type ChunkMatch = RetrievedChunk;

async function withPrismaRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    console.error("RAG keyword query failed, retrying once:", error);
    await prisma.$connect();
    return run();
  }
}

export async function keywordSearch(
  query: string,
  limit = 5
): Promise<ChunkMatch[]> {

  const rows = await withPrismaRetry(() =>
    prisma.$queryRawUnsafe<ChunkMatch[]>(
      `
        SELECT
          content,
          file_id,
          NULL AS distance
        FROM document_chunks
        WHERE to_tsvector('english', content) @@ plainto_tsquery($1)
        LIMIT $2
      `,
      query,
      limit
    )
  );

  return rows ?? [];
}
