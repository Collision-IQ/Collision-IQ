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

  const { sourceType, driveFileId, drivePath, modifiedTime, chunks } = params;
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

  /*
  ----------------------------------------
  Build values list
  ----------------------------------------
  */

  const values = chunks.map((c) => {

    const id = `${driveFileId}:${c.chunkIndex}:${modifiedTime}`;

    const embedding =
      Array.isArray(c.embedding[0])
        ? (c.embedding as number[][])[0]
        : (c.embedding as number[]);

    const vec = `[${embedding
      .map((n) => (Number.isFinite(n) ? n : 0))
      .join(",")}]`;

    const authority = c.authority ?? 50;

    return {
      id,
      source: sourceType,
      file_id: driveFileId,
      chunk_index: c.chunkIndex,
      content: c.content,
      embedding: vec,
      system: c.system ?? null,
      component: c.component ?? null,
      procedure: c.procedure ?? null,
      doc_type: c.docType ?? null,
      authority,
    };

  });

  /*
  ----------------------------------------
  Insert rows
  ----------------------------------------
  */

  for (const v of values) {
    if (sourceColumn) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO document_chunks
        (
          id,
          ${sourceColumn},
          file_id,
          chunk_index,
          content,
          embedding,
          updated_at,
          system,
          component,
          procedure,
          doc_type,
          authority
        )
        VALUES
        (
          $1,$2,$3,$4,$5,$6,NOW(),$7,$8,$9,$10,$11
        )
        ON CONFLICT (id) DO UPDATE SET
          content = EXCLUDED.content,
          embedding = EXCLUDED.embedding,
          updated_at = NOW(),
          system = EXCLUDED.system,
          component = EXCLUDED.component,
          procedure = EXCLUDED.procedure,
          doc_type = EXCLUDED.doc_type,
          authority = EXCLUDED.authority
      `,
        v.id,
        v.source,
        v.file_id,
        v.chunk_index,
        v.content,
        v.embedding,
        v.system,
        v.component,
        v.procedure,
        v.doc_type,
        v.authority
      );
      continue;
    }

    await prisma.$executeRawUnsafe(`
      INSERT INTO document_chunks
      (
        id,
        file_id,
        chunk_index,
        content,
        embedding,
        updated_at,
        system,
        component,
        procedure,
        doc_type,
        authority
      )
      VALUES
      (
        $1,$2,$3,$4,$5,NOW(),$6,$7,$8,$9,$10
      )
      ON CONFLICT (id) DO UPDATE SET
        content = EXCLUDED.content,
        embedding = EXCLUDED.embedding,
        updated_at = NOW(),
        system = EXCLUDED.system,
        component = EXCLUDED.component,
        procedure = EXCLUDED.procedure,
        doc_type = EXCLUDED.doc_type,
        authority = EXCLUDED.authority
    `,
      v.id,
      v.file_id,
      v.chunk_index,
      v.content,
      v.embedding,
      v.system,
      v.component,
      v.procedure,
      v.doc_type,
      v.authority
    );

  }
}
