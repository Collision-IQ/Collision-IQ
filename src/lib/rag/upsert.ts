import { prisma } from "@/lib/prisma";

export async function upsertChunks(params: {
  driveFileId: string;
  drivePath: string;
  modifiedTime: string;
  chunks: { text: string; embedding: number[]; chunkIndex: number }[];
}) {
  const { driveFileId, drivePath, modifiedTime, chunks } = params;

  // Remove stale chunks from previous versions of this file
  await prisma.$executeRawUnsafe(`
    DELETE FROM document_chunks
    WHERE drive_file_id = '${driveFileId}'
    AND id NOT LIKE '${driveFileId}:%:${modifiedTime}'
  `);

  for (const c of chunks) {
    const id = `${driveFileId}:${c.chunkIndex}:${modifiedTime}`;

    // embedding vector literal
    const vec = `[${c.embedding.map((n) => (Number.isFinite(n) ? n : 0)).join(",")}]`;

    await prisma.$queryRawUnsafe(`
      INSERT INTO document_chunks (id, source, drive_file_id, drive_path, chunk_index, text, embedding, updated_at)
      VALUES ('${id}', 'drive', '${driveFileId}', '${drivePath}', ${c.chunkIndex}, $$${c.text}$$, '${vec}', NOW())
      ON CONFLICT (id) DO UPDATE SET
        text = EXCLUDED.text,
        embedding = EXCLUDED.embedding,
        updated_at = NOW();
    `);
  }
}