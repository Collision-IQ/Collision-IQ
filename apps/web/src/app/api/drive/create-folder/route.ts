export const runtime = "nodejs";

// app/api/drive/create-folder/route.ts

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

    const folder = await drive.files.create({
      supportsAllDrives: true,
      requestBody: {
        name: "Mirror_Test_Folder",
        mimeType: "application/vnd.google-apps.folder",
        parents: [driveId],
      },
    });

    return NextResponse.json({
      ok: true,
      folder: folder.data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Drive folder creation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
