/**
 * The Drive RAG tables, as prisma/migrations creates them on a fresh
 * database, against the code that writes and reads them: upsertChunks,
 * searchChunks (pgvector distance) and keywordSearch (full text). Before
 * 20261003120000_add_rag_and_drive_watch_tables no migration created these
 * tables, so a database built from migrations alone could not run retrieval.
 *
 * Runs when TEST_DATABASE_URL names a database migrated with
 * prisma/migrations (pgvector required); skipped otherwise.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;
const FILE_ID = "rag-tables-db-test-file";

describe.skipIf(!url)("Drive RAG tables from migrations (Postgres + pgvector)", () => {
  let rag: {
    upsertChunks: typeof import("@/lib/rag/upsert").upsertChunks;
    searchChunks: typeof import("@/lib/rag/searchChunks").searchChunks;
    keywordSearch: typeof import("@/lib/rag/keywordSearch").keywordSearch;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    rag = {
      upsertChunks: (await import("@/lib/rag/upsert")).upsertChunks,
      searchChunks: (await import("@/lib/rag/searchChunks")).searchChunks,
      keywordSearch: (await import("@/lib/rag/keywordSearch")).keywordSearch,
    };
  });
  afterAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$executeRawUnsafe(`DELETE FROM document_chunks WHERE file_id = $1`, FILE_ID);
    await prisma.$disconnect();
  });

  it("stores chunks and finds them by vector distance and by keyword", async () => {
    await rag.upsertChunks({
      sourceType: "google",
      driveFileId: FILE_ID,
      drivePath: "/OEM/test-procedure.pdf",
      modifiedTime: "2026-10-03T00:00:00.000Z",
      chunks: [
        { content: "Pre-repair scan required before disassembly", embedding: [1, 0, 0], chunkIndex: 0, docType: "procedure", authority: 90 },
        { content: "Blend adjacent panels for color match", embedding: [0, 1, 0], chunkIndex: 1 },
      ],
    });

    const nearest = await rag.searchChunks([0.9, 0.1, 0], 2);
    expect(nearest[0]?.content).toBe("Pre-repair scan required before disassembly");

    const byKeyword = await rag.keywordSearch("blend panels", 5);
    expect(byKeyword.map((chunk) => chunk.content)).toContain("Blend adjacent panels for color match");
  });

  it("re-ingesting a file replaces its chunks instead of duplicating them", async () => {
    await rag.upsertChunks({
      sourceType: "google",
      driveFileId: FILE_ID,
      drivePath: "/OEM/test-procedure.pdf",
      modifiedTime: "2026-10-04T00:00:00.000Z",
      chunks: [{ content: "Revised: post-repair scan required", embedding: [1, 0, 0], chunkIndex: 0 }],
    });
    const { prisma } = await import("@/lib/prisma");
    const rows = await prisma.$queryRawUnsafe<Array<{ content: string; source: string }>>(
      `SELECT content, source FROM document_chunks WHERE file_id = $1`,
      FILE_ID
    );
    expect(rows).toEqual([{ content: "Revised: post-repair scan required", source: "google" }]);
  });
});
