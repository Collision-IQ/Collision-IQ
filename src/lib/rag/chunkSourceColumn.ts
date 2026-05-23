import { prisma } from "@/lib/prisma";

type ChunkSourceColumn = "source_type" | "source" | null;

let cachedColumn: ChunkSourceColumn | undefined;

export async function getChunkSourceColumn(): Promise<ChunkSourceColumn> {
  if (cachedColumn !== undefined) {
    return cachedColumn;
  }

  const rows = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'document_chunks'
        AND column_name IN ('source_type', 'source')
    `
  );

  if (rows.some((row) => row.column_name === "source_type")) {
    cachedColumn = "source_type";
    return cachedColumn;
  }

  if (rows.some((row) => row.column_name === "source")) {
    cachedColumn = "source";
    return cachedColumn;
  }

  cachedColumn = null;
  return cachedColumn;
}
