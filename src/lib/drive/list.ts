import { drive_v3 } from "googleapis";

export async function listDriveFiles(
  drive: drive_v3.Drive,
  driveId: string
) {
  const results: (drive_v3.Schema$File & { path?: string })[] = [];

  async function crawl(folderId: string, path = "") {
    let pageToken: string | undefined;

    do {
      const res = await drive.files.list({
        corpora: "drive",
        driveId,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        q: `'${folderId}' in parents and trashed = false`,
        fields: "nextPageToken, files(id,name,mimeType,modifiedTime,parents,size)",
        pageSize: 100,
        pageToken
      });

      const files = res.data.files ?? [];

      for (const file of files) {
        if (file.mimeType === "application/vnd.google-apps.folder") {
          // recurse into folder
          await crawl(file.id!, `${path}/${file.name}`);
        } else {
          results.push({
            ...file,
            path: `${path}${file.name}`
          });
        }
      }

      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  // Start crawling from the shared drive root
  await crawl(process.env.GOOGLE_DRIVE_MIRROR_ROOT_ID!);

  return results;
}