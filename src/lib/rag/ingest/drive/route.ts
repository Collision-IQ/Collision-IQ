import { NextResponse } from "next/server";
export const runtime = "nodejs";

import { embedTexts } from "@/lib/rag/embed";
import { upsertChunks } from "@/lib/rag/upsert";
import { listDriveFiles } from "@/lib/drive/list";
import { extractDriveText } from "@/lib/drive/extract";
import { getImpersonatedAuth } from "@/lib/drive/auth";
import { google } from "googleapis";

import { procedureChunk } from "@/lib/rag/procedureChunk";
import { extractMetadata } from "@/lib/rag/metadata";

const DRIVE_ID = process.env.GOOGLE_SHARED_DRIVE_ID!;
type DriveFileWithPath = {
  id?: string | null;
  name?: string | null;
  modifiedTime?: string | null;
  path?: string | null;
};

export async function POST() {
  if (!DRIVE_ID) {
    return NextResponse.json(
      { error: "Missing GOOGLE_SHARED_DRIVE_ID" },
      { status: 500 }
    );
  }

  const auth = await getImpersonatedAuth();
  const drive = google.drive({ version: "v3", auth });

  const files = await listDriveFiles(drive, DRIVE_ID);

  let indexed = 0;
  let skipped = 0;

  for (const f of files) {
    if (!f.id) {
      skipped++;
      continue;
    }

    const extracted = await extractDriveText(drive, f);

    if (!extracted.ok) {
      skipped++;
      continue;
    }

    const text = extracted.text;

    if (!text || !text.trim()) {
      skipped++;
      continue;
    }

    const rawChunks = procedureChunk(text);

    if (!rawChunks.length) {
      skipped++;
      continue;
    }

    const embeddings = await embedTexts(
      rawChunks.map(c => typeof c === "string" ? c : c.text)
    );

    const chunks = rawChunks
      .map((chunk, i) => {

      const chunkText =
        typeof chunk === "string"
          ? chunk
          : chunk.text;
        const embedding = embeddings[i];

        if (!embedding?.length) return null;

        const metadata = extractMetadata({
          text: chunkText,
          drivePath: (f as DriveFileWithPath).path || f.name || ""
        });

        return {
          chunkIndex: i,
          text: chunkText,
          embedding,
          ...metadata
        };
      })
      .filter(
        (c): c is {
          chunkIndex: number
          text: string
          embedding: number[]
          oem: string | null
          system: string | null
          component: string | null
          procedure: string | null
        } => Boolean(c)
      );

    if (!chunks.length) {
      skipped++;
      continue;
    }

    await upsertChunks({
      driveFileId: f.id,
      drivePath: (f as DriveFileWithPath).path || f.name || "",
      modifiedTime: f.modifiedTime || "unknown",
      chunks
    });

    indexed++;
  }

  return NextResponse.json({
    indexed,
    skipped,
    total: files.length
  });
}
