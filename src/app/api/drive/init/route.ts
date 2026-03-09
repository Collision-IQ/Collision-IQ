import { NextResponse } from "next/server";
import { google } from "googleapis";
import { getDriveAuth } from "@/lib/drive/auth";
import { prisma } from "@/lib/prisma";

export async function POST() {
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

  return NextResponse.json({ token });
}