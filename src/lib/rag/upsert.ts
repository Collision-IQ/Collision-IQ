import { prisma } from "@/lib/prisma"

export async function upsertChunks(params: {
  driveFileId: string
  drivePath: string
  modifiedTime: string
  chunks: {
    text: string
    embedding: number[] | number[][]
    chunkIndex: number
    oem?: string | null
    system?: string | null
    component?: string | null
    procedure?: string | null
  }[]
}) {

  const { driveFileId, drivePath, modifiedTime, chunks } = params

  /*
  ----------------------------------------
  Remove stale chunks from previous version
  ----------------------------------------
  */

  await prisma.$executeRawUnsafe(`
    DELETE FROM document_chunks
    WHERE drive_file_id = '${driveFileId}'
    AND id NOT LIKE '${driveFileId}:%:${modifiedTime}'
  `)

  if (!chunks.length) return

  /*
  ----------------------------------------
  Build batched VALUES list
  ----------------------------------------
  */

  const values = chunks.map(c => {

    const id = `${driveFileId}:${c.chunkIndex}:${modifiedTime}`

    const embedding =
      Array.isArray(c.embedding[0])
        ? (c.embedding as number[][])[0]
        : (c.embedding as number[])

    const vec = `[${embedding
      .map(n => (Number.isFinite(n) ? n : 0))
      .join(",")}]`

    const oem = c.oem ? `$$${c.oem}$$` : "NULL"
    const system = c.system ? `$$${c.system}$$` : "NULL"
    const component = c.component ? `$$${c.component}$$` : "NULL"
    const procedure = c.procedure ? `$$${c.procedure}$$` : "NULL"

    return `
      (
        '${id}',
        'drive',
        '${driveFileId}',
        '${drivePath}',
        ${c.chunkIndex},
        $$${c.text}$$,
        '${vec}',
        NOW(),
        ${oem},
        ${system},
        ${component},
        ${procedure}
      )
    `
  }).join(",")

  /*
  ----------------------------------------
  Batched upsert
  ----------------------------------------
  */

  await prisma.$queryRawUnsafe(`
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
      procedure
    )
    VALUES ${values}
    ON CONFLICT (id) DO UPDATE SET
      text = EXCLUDED.text,
      embedding = EXCLUDED.embedding,
      updated_at = NOW(),
      oem = EXCLUDED.oem,
      system = EXCLUDED.system,
      component = EXCLUDED.component,
      procedure = EXCLUDED.procedure
  `)
}