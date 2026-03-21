import { NextResponse } from "next/server";
export const runtime = "nodejs";

import { embedText } from "@/lib/rag/embed";
import { chunkText } from "@/lib/rag/chunk";
import { upsertChunks } from "@/lib/rag/upsert";
import { listDriveFiles } from "@/lib/drive/list";
import { extractDriveText } from "@/lib/drive/extract";

// TODO: import your existing impersonation auth builder here
import { getImpersonatedAuth } from "@/lib/drive/auth"; // adjust to your real path
import { google } from "googleapis";

const DRIVE_ID = process.env.GOOGLE_SHARED_DRIVE_ID!;

export async function POST() {
  if (!DRIVE_ID) {
    return NextResponse.json({ error: "Missing GOOGLE_SHARED_DRIVE_ID" }, { status: 500 });
  }

  const auth = await getImpersonatedAuth(); // must return google auth client
  const drive = google.drive({ version: "v3", auth });

  const files = await listDriveFiles(drive, DRIVE_ID);

  let indexed = 0;
  let skipped = 0;

  for (const f of files) {
    if (!f.id) continue;

    const extracted = await extractDriveText(drive, f);

    if (!extracted.ok) {
      skipped++;
      console.log("Skipped file:", {
        name: f.name,
        id: f.id,
        mimeType: f.mimeType,
        reason: extracted.reason,
      });
      continue;
    }

    const text = extracted.text;
    const chunks = chunkText(text);

    // embed + upsert
      const embeddedChunks = [];
      for (let i = 0; i < chunks.length; i++) {
        const emb = await embedText(chunks[i]);
        if (!emb.length) continue;
        embeddedChunks.push({ chunkIndex: i, content: chunks[i], embedding: emb });
      }

    await upsertChunks({
      sourceType: "google",
      driveFileId: f.id,
      drivePath: f.name || "",
      modifiedTime: f.modifiedTime || "unknown",
      chunks: embeddedChunks,
    });

    indexed++;
  }

  return NextResponse.json({ indexed, skipped, total: files.length });
}
