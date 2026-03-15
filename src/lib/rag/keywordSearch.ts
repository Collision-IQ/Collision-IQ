import { prisma } from "@/lib/prisma";

type ChunkMatch = {
  text: string;
  drive_path: string | null;
  similarity: number | null;
};

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
          text,
          drive_path,
          NULL AS similarity
        FROM document_chunks
        WHERE to_tsvector('english', text) @@ plainto_tsquery($1)
        LIMIT $2
      `,
      query,
      limit
    )
  );

  return rows ?? [];
}
