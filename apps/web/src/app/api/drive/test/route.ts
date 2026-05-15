export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { google } from "googleapis";
import { getDriveAuth } from "@/lib/drive/auth";

export async function GET() {
  try {
    const driveId = process.env.GOOGLE_SHARED_DRIVE_ID;
    if (!driveId) {
      return NextResponse.json({ error: "Missing GOOGLE_SHARED_DRIVE_ID" }, { status: 500 });
    }

    const auth = await getDriveAuth();
    const drive = google.drive({ version: "v3", auth });

    const res = await drive.files.list({
      corpora: "drive",
      driveId,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      pageSize: 5,
      fields: "files(id,name)",
    });

    return NextResponse.json({
      ok: true,
      files: res.data.files,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Drive test failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
