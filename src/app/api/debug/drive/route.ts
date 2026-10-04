import { google } from "googleapis";
import { NextResponse } from "next/server";
import { getDriveAuth } from "@/lib/drive/auth";
import { requirePlatformAdminResponse } from "@/lib/auth/requirePlatformAdminResponse";

export async function GET() {
  const denied = await requirePlatformAdminResponse();
  if (denied) return denied;

  try {
    // The service account (domain-wide delegation) every other Drive path uses;
    // the old personal OAuth refresh token (GOOGLE_REFRESH_TOKEN) is revoked.
    const driveAuth = await getDriveAuth();

const drive = google.drive({
      version: "v3",
      auth: driveAuth,
    });

    const response = await drive.files.list({
      pageSize: 5,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      fields: "files(id, name, parents, driveId, mimeType)",
    });

    return NextResponse.json({
      success: true,
      files: response.data.files,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";

    console.error("DRIVE ERROR:", err);

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 },
    );
  }
}
