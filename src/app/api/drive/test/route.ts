import { NextResponse } from "next/server";
import { getDriveClient } from "@/lib/googleDrive";

export async function GET() {
  const drive = getDriveClient();
  const driveId = process.env.GOOGLE_SHARED_DRIVE_ID!;

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
}
