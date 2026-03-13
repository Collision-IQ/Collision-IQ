import { prisma } from "@/lib/prisma";

export async function upsertChunks(params: {
  driveFileId: string;
  drivePath: string;
  modifiedTime: string;
  chunks: {
    text: string;
    embedding: number[] | number[][];
    chunkIndex: number;

    oem?: string | null;
    system?: string | null;
    component?: string | null;
    procedure?: string | null;

    // new metadata
    docType?: string | null;
    authority?: number | null;
  }[];
}) {

  const { driveFileId, drivePath, modifiedTime, chunks } = params;

  /*
  ----------------------------------------
  Remove stale chunks
  ----------------------------------------
  */

  await prisma.$executeRawUnsafe(`
    DELETE FROM document_chunks
    WHERE drive_file_id = $1
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
      source: "drive",
      drive_file_id: driveFileId,
      drive_path: drivePath,
      chunk_index: c.chunkIndex,
      text: c.text,
      embedding: vec,
      oem: c.oem ?? null,
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

    await prisma.$executeRawUnsafe(`
      INSERT INTO document_chunks
      (
        id,
        source,
        drive_file_id,
        drive_path,
        chunk_index,
        text,
        embedding,
        updated_at,
        oem,
        system,
        component,
        procedure,
        doc_type,
        authority
      )
      VALUES
      (
        $1,$2,$3,$4,$5,$6,$7,NOW(),$8,$9,$10,$11,$12,$13
      )
      ON CONFLICT (id) DO UPDATE SET
        text = EXCLUDED.text,
        embedding = EXCLUDED.embedding,
        updated_at = NOW(),
        oem = EXCLUDED.oem,
        system = EXCLUDED.system,
        component = EXCLUDED.component,
        procedure = EXCLUDED.procedure,
        doc_type = EXCLUDED.doc_type,
        authority = EXCLUDED.authority
    `,
      v.id,
      v.source,
      v.drive_file_id,
      v.drive_path,
      v.chunk_index,
      v.text,
      v.embedding,
      v.oem,
      v.system,
      v.component,
      v.procedure,
      v.doc_type,
      v.authority
    );

  }
}