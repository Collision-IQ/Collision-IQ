import { NextResponse } from "next/server";
export const runtime = "nodejs";

import { getConfiguredDriveRootFolders, listDriveFiles } from "@/lib/drive/list";
import { extractDriveText } from "@/lib/drive/extract";
import { getImpersonatedAuth } from "@/lib/drive/auth";
import { google } from "googleapis";
import { ingestDocument } from "@/lib/rag/ingestDocument";

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

  const rootFolderIds = getConfiguredDriveRootFolders();
  const files = await listDriveFiles(drive, {
    driveId: DRIVE_ID,
    rootFolderIds,
  });

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

    const chunkCount = await ingestDocument({
      fileId: f.id,
      text,
      path: (f as DriveFileWithPath).path || f.name || "",
      modifiedTime: f.modifiedTime || "unknown",
      sourceType: "google",
    });

    if (!chunkCount) {
      skipped++;
      continue;
    }

    indexed++;
  }

  return NextResponse.json({
    indexed,
    skipped,
    total: files.length
  });
}
