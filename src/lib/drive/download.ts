import { google } from "googleapis";
import { getDriveAuth } from "@/lib/drive/auth";

const GOOGLE_DOC_EXPORT_MIME_TYPES: Record<string, { mimeType: string; extension: string }> = {
  "application/vnd.google-apps.document": {
    mimeType: "text/plain",
    extension: ".txt",
  },
  "application/vnd.google-apps.spreadsheet": {
    mimeType: "text/csv",
    extension: ".csv",
  },
  "application/vnd.google-apps.presentation": {
    mimeType: "application/pdf",
    extension: ".pdf",
  },
};

export type DriveDownloadedFile = {
  id: string;
  name: string;
  mimeType: string | null;
  buffer: Buffer;
  webViewLink?: string | null;
  webContentLink?: string | null;
  parentIds: string[];
};

export function isDriveEnabled() {
  return process.env.GOOGLE_DRIVE_ENABLED === "true";
}

export function extractDriveFileIdFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (!/(^|\.)google\.com$/i.test(url.hostname) && !/\.google\.com$/i.test(url.hostname)) {
      return null;
    }

    const idParam = url.searchParams.get("id");
    if (idParam) return idParam;

    const match = url.pathname.match(/\/(?:file|document|spreadsheets|presentation)\/d\/([^/]+)/i);
    if (match?.[1]) return match[1];

    const foldersMatch = url.pathname.match(/\/folders\/([^/]+)/i);
    if (foldersMatch?.[1]) return foldersMatch[1];

    return null;
  } catch {
    return null;
  }
}

export async function downloadDriveFile(fileId: string): Promise<DriveDownloadedFile> {
  if (!isDriveEnabled()) {
    throw new Error("drive_disabled");
  }

  const auth = await getDriveAuth();
  const drive = google.drive({ version: "v3", auth });
  const metadata = await drive.files.get({
    fileId,
    supportsAllDrives: true,
    fields: "id,name,mimeType,parents,webViewLink,webContentLink",
  });
  const sourceMimeType = metadata.data.mimeType ?? null;
  const exportConfig = sourceMimeType ? GOOGLE_DOC_EXPORT_MIME_TYPES[sourceMimeType] : undefined;
  const name = metadata.data.name ?? fileId;

  const response = exportConfig
    ? await drive.files.export(
        { fileId, mimeType: exportConfig.mimeType },
        { responseType: "arraybuffer" }
      )
    : await drive.files.get(
        { fileId, alt: "media", supportsAllDrives: true },
        { responseType: "arraybuffer" }
      );

  const data = response.data;
  const buffer = Buffer.isBuffer(data)
    ? data
    : Buffer.from(data as ArrayBuffer);
  const finalMimeType = exportConfig?.mimeType ?? sourceMimeType;
  const finalName =
    exportConfig && !name.toLowerCase().endsWith(exportConfig.extension)
      ? `${name}${exportConfig.extension}`
      : name;

  return {
    id: metadata.data.id ?? fileId,
    name: finalName,
    mimeType: finalMimeType,
    buffer,
    webViewLink: metadata.data.webViewLink ?? null,
    webContentLink: metadata.data.webContentLink ?? null,
    parentIds: metadata.data.parents ?? [],
  };
}
