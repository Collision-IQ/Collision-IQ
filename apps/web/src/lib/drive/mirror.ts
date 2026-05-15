import { google } from "googleapis";
import { getDriveAuth } from "@/lib/drive/auth";

const DRIVE_MIRROR_ROOT_ID = (() => {
  const v = process.env.GOOGLE_DRIVE_MIRROR_ROOT_ID;
  if (!v) throw new Error("Missing GOOGLE_DRIVE_MIRROR_ROOT_ID");
  return v;
})();

function splitParentAndName(fullPath: string): { parentPath: string; fileName: string } {
  const parts = fullPath.split("/").filter(Boolean);
  const fileName = parts.pop();

  if (!fileName) {
    throw new Error(`Invalid path: ${fullPath}`);
  }

  return {
    parentPath: "/" + parts.join("/"),
    fileName,
  };
}

async function findChildFolder(
  drive: ReturnType<typeof google.drive>,
  parentId: string,
  name: string
): Promise<string | null> {
  const res = await drive.files.list({
    q: [
      `'${parentId}' in parents`,
      `mimeType = 'application/vnd.google-apps.folder'`,
      `name = '${name.replace(/'/g, "\\'")}'`,
      `trashed = false`,
    ].join(" and "),
    fields: "files(id, name)",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });

  return res.data.files?.[0]?.id ?? null;
}

async function createFolder(
  drive: ReturnType<typeof google.drive>,
  parentId: string,
  name: string
): Promise<string> {
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
    supportsAllDrives: true,
  });

  if (!res.data.id) throw new Error(`Failed to create folder: ${name}`);
  return res.data.id;
}

export async function ensureDriveFolderPath(path: string): Promise<string> {
  const auth = await getDriveAuth();
  const drive = google.drive({ version: "v3", auth });

  const parts = path.split("/").filter(Boolean);
  let currentParentId = DRIVE_MIRROR_ROOT_ID;

  for (const part of parts) {
    const existingId = await findChildFolder(drive, currentParentId, part);
    currentParentId =
      existingId ?? (await createFolder(drive, currentParentId, part));
  }

  return currentParentId;
}

export async function uploadOrReplaceMirroredFile(params: {
  drivePath: string;
  bytes: Buffer;
  mimeType?: string;
  existingDriveFileId?: string | null;
}) {
  const auth = await getDriveAuth();
  const drive = google.drive({ version: "v3", auth });

  const { parentPath, fileName } = splitParentAndName(params.drivePath);
  const parentId = await ensureDriveFolderPath(parentPath);

  if (params.existingDriveFileId) {
    const updated = await drive.files.update({
      fileId: params.existingDriveFileId,
      media: {
        mimeType: params.mimeType ?? "application/octet-stream",
        body: params.bytes,
      },
      fields: "id, name, parents",
      supportsAllDrives: true,
    });

    return updated.data;
  }

  const created = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [parentId],
    },
    media: {
      mimeType: params.mimeType ?? "application/octet-stream",
      body: params.bytes,
    },
    fields: "id, name, parents",
    supportsAllDrives: true,
  });

  return created.data;
}