import { sql } from "@/lib/db";
import type { RetrievedChunk } from "@/lib/types";
import { getChunkSourceColumn } from "./chunkSourceColumn";

export async function searchChunks(
  embedding: number[],
  limit = 5
): Promise<RetrievedChunk[]> {
  const safeLimit = Math.max(1, Math.min(limit, 20));
  const sourceColumn = await getChunkSourceColumn();
  const sourceFilter = sourceColumn
    ? `AND ${sourceColumn} IN ('google', 'onedrive1', 'onedrive2')`
    : "";
  const queryVector = JSON.stringify(embedding);

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
}
