import { sql } from "@/lib/db";
import type { RetrievedChunk } from "@/lib/types";

export async function searchChunks(
  embedding: number[],
  limit = 5
): Promise<RetrievedChunk[]> {
  const safeLimit = Math.max(1, Math.min(limit, 20));

  const result = await sql<{
    id: string;
    content: string;
    file_id: string;
    distance: string | number;
  }>`
    SELECT
      id,
      content,
      file_id,
      (embedding <-> ${JSON.stringify(embedding)}::vector) AS distance
    FROM document_chunks
    WHERE embedding IS NOT NULL
      AND source_type IN ('google', 'onedrive1', 'onedrive2')
    ORDER BY distance ASC
    LIMIT ${safeLimit}
  `;

  return result.rows.map((row: (typeof result.rows)[number]) => ({
    id: row.id,
    content: row.content,
    file_id: row.file_id,
    distance: Number(row.distance),
  }));
}
