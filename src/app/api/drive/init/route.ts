export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { google } from "googleapis";
import { getDriveAuth } from "@/lib/drive/auth";
import { prisma } from "@/lib/prisma";

async function initializeDrive() {
  const auth = await getDriveAuth();
  const drive = google.drive({ version: "v3", auth });

  const res = await drive.changes.getStartPageToken({
    supportsAllDrives: true
  });

  const token = res.data.startPageToken;

  await prisma.$executeRawUnsafe(`
    UPDATE drive_watch_state
    SET last_page_token = '${token}'
    WHERE id = 'drive'
  `);

  return NextResponse.json({
    message: "Drive initialized",
    token,
  });
}

export async function POST() {
  try {
    return await initializeDrive();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Drive initialization failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Use POST to initialize the Drive start page token."
  });
}
