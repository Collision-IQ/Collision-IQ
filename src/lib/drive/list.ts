import { drive_v3, google } from "googleapis";

/** You already have an auth helper elsewhere; plug it in here */
export function getDriveClient(auth: any) {
  return google.drive({ version: "v3", auth }) as drive_v3.Drive;
}

export async function listDriveFiles(drive: drive_v3.Drive, driveId: string) {
  const files: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      corpora: "drive",
      driveId,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      pageSize: 100,
      pageToken,
      q: "trashed = false",
      fields: "nextPageToken, files(id,name,mimeType,modifiedTime,parents,size)",
    });

    files.push(...(res.data.files ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return files;
}