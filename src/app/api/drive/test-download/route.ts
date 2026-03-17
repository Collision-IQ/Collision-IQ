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

    const fileId = "1QqXq-KHPUBtcekzf2Zg-gpNrYgIufv_o";

    const response = await drive.files.get({
      fileId,
      alt: "media",
      supportsAllDrives: true,
      acknowledgeAbuse: true,
    });

    return NextResponse.json({
      success: true,
      contentPreview: JSON.stringify(response.data).slice(0, 500),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";

    console.error("DOWNLOAD ERROR:", err);

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 },
    );
  }
}
