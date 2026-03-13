import { NextResponse } from "next/server";
import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { getDriveAuth } from "@/lib/drive/auth";

export async function POST() {
  const auth = await getDriveAuth();
  const drive = google.drive({ version: "v3", auth });

  type WatchStateRow = { last_page_token: string };

  const state = await prisma.$queryRawUnsafe<WatchStateRow[]>(`
    SELECT last_page_token
    FROM drive_watch_state
    WHERE id = 'drive'
`);

  const pageToken = state?.[0]?.last_page_token;

  const res = await drive.changes.list({
    pageToken,
    fields: "changes(fileId,file(name,mimeType,modifiedTime)),newStartPageToken",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });

  for (const change of res.data.changes || []) {

  const file = change.file

  if (!file) continue

  // skip folders
  if (file.mimeType === "application/vnd.google-apps.folder") {
    continue
  }

  // skip unsupported mime types
  if (!file.mimeType?.startsWith("application/") &&
      !file.mimeType?.startsWith("text/")) {
    continue
  }

  const fileId = change.fileId

  await fetch(`${process.env.APP_BASE_URL}/api/rag/ingest/drive`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ fileId })
  })
}

  if (res.data.newStartPageToken) {
    await prisma.$executeRawUnsafe(`
      UPDATE drive_watch_state
      SET last_page_token = '${res.data.newStartPageToken}'
      WHERE id = 'drive'
    `);
  }

  return NextResponse.json({ ok: true });
}