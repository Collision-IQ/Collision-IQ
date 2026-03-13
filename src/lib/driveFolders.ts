import { getDriveClient } from "./googleDrive";

export async function ensureFolderPath(
  fullPath: string,
  driveId: string
) {
  const drive = getDriveClient();

  const parts = fullPath.split("/").filter(Boolean);

  let parentId = driveId;

  for (const part of parts) {
    const existing = await drive.files.list({
      q: `'${parentId}' in parents and name='${part}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      fields: "files(id,name)",
    });

    if (existing.data.files && existing.data.files.length > 0) {
      parentId = existing.data.files[0].id!;
    } else {
      const created = await drive.files.create({
        supportsAllDrives: true,
        requestBody: {
          name: part,
          mimeType: "application/vnd.google-apps.folder",
          parents: [parentId],
        },
        fields: "id",
      });

      parentId = created.data.id!;
    }
  }

  return parentId;
}