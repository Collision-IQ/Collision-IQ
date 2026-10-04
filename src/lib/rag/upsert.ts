import { prisma } from "@/lib/prisma";
import { getChunkSourceColumn } from "./chunkSourceColumn";

export async function upsertChunks(params: {
  sourceType: "google" | "onedrive1" | "onedrive2";
  driveFileId: string;
  drivePath: string;
  modifiedTime: string;
  chunks: {
    content: string;
    embedding: number[] | number[][];
    chunkIndex: number;

    system?: string | null;
    component?: string | null;
    procedure?: string | null;

    // new metadata
    docType?: string | null;
    authority?: number | null;
  }[];
}) {

  // drivePath, modifiedTime and the per-chunk metadata (chunkIndex, system,
  // component, procedure, docType, authority) are accepted but not stored:
  // production's document_chunks has only id (serial), content, embedding and
  // file_id, plus an optional source column, and nothing reads the rest.
  const { sourceType, driveFileId, chunks } = params;
  const sourceColumn = await getChunkSourceColumn();

  /*
  ----------------------------------------
  Remove stale chunks
  ----------------------------------------
  */

  await prisma.$executeRawUnsafe(`
    DELETE FROM document_chunks
    WHERE file_id = $1
  `, driveFileId);

  if (!chunks.length) return;

  // The embedding is passed as "[x,y,...]" text; Postgres will not assign text
  // to a vector column without the explicit ::vector cast.
  for (const c of chunks) {
    const embedding = Array.isArray(c.embedding[0])
      ? (c.embedding as number[][])[0]
      : (c.embedding as number[]);
    const vec = `[${embedding.map((n) => (Number.isFinite(n) ? n : 0)).join(",")}]`;

    if (sourceColumn) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO document_chunks (${sourceColumn}, file_id, content, embedding)
         VALUES ($1, $2, $3, $4::vector)`,
        sourceType,
        driveFileId,
        c.content,
        vec
      );
      continue;
    }

    await prisma.$executeRawUnsafe(
      `INSERT INTO document_chunks (file_id, content, embedding)
       VALUES ($1, $2, $3::vector)`,
      driveFileId,
      c.content,
      vec
    );
  }
}
