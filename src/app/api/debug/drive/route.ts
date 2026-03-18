import { google } from "googleapis";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    );

    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    });

    const drive = google.drive({
      version: "v3",
      auth: oauth2Client,
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
