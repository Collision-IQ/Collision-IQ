// app/api/drive/create-folder/route.ts

import { NextResponse } from "next/server";
import { getDriveClient } from "@/lib/googleDrive";

export async function GET() {
  const drive = getDriveClient();
  const driveId = process.env.GOOGLE_SHARED_DRIVE_ID!;

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
}