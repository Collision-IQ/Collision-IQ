import { drive_v3 } from "googleapis";

export async function listDriveFiles(
  drive: drive_v3.Drive,
  driveIdOrParams:
    | string
    | {
        driveId: string;
        rootFolderIds: Array<string | { label: string; id: string }>;
      }
) {
  const driveId =
    typeof driveIdOrParams === "string"
      ? driveIdOrParams
      : driveIdOrParams.driveId;
  const rootFolders =
    typeof driveIdOrParams === "string"
      ? [{ label: "GOOGLE_DRIVE_MIRROR_ROOT_ID", id: process.env.GOOGLE_DRIVE_MIRROR_ROOT_ID! }].filter((value) => Boolean(value.id))
      : driveIdOrParams.rootFolderIds.map((value) =>
          typeof value === "string" ? { label: "rootFolderId", id: value } : value
        );
  const results: (drive_v3.Schema$File & { path?: string })[] = [];
  const seenFolders = new Set<string>();

  async function crawl(folderId: string, path = "") {
    if (seenFolders.has(folderId)) return;
    seenFolders.add(folderId);

    let pageToken: string | undefined;
    const q = `'${folderId}' in parents and trashed = false`;

    do {
      let res;
      try {
        res = await drive.files.list({
          corpora: "drive",
          driveId,
          includeItemsFromAllDrives: true,
          supportsAllDrives: true,
          q,
          fields: "nextPageToken, files(id,name,mimeType,modifiedTime,parents,size)",
          pageSize: 100,
          pageToken
        });
        console.log({
          operation: "list",
          driveId,
          folderId,
          q,
          fileCount: res.data.files?.length ?? 0,
        });
      } catch (error) {
        console.log({
          operation: "list",
          driveId,
          folderId,
          q,
          error: error instanceof Error ? error.message : String(error),
          status:
            typeof error === "object" && error && "code" in error
              ? (error as { code?: unknown }).code
              : undefined,
        });
        throw error;
      }

      const files = res.data.files ?? [];

      for (const file of files) {
        if (!file.id || !file.name) continue;

        if (file.mimeType === "application/vnd.google-apps.folder") {
          await crawl(file.id, `${path}${file.name}/`);
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

  for (const rootFolder of rootFolders) {
    const rootFolderId = rootFolder.id;
    try {
      const probe = await drive.files.get({
        fileId: rootFolderId,
        supportsAllDrives: true,
        fields: "id,name,driveId,parents,mimeType",
      });
      console.log({
        operation: "probe",
        label: rootFolder.label,
        driveId,
        folderId: rootFolderId,
        rootFolderId,
        metadata: probe.data,
      });
    } catch (error) {
      console.log({
        operation: "probe",
        label: rootFolder.label,
        driveId,
        folderId: rootFolderId,
        rootFolderId,
        error: error instanceof Error ? error.message : String(error),
        status:
          typeof error === "object" && error && "code" in error
            ? (error as { code?: unknown }).code
            : undefined,
      });
    }

    try {
      console.log("[drive] crawling root folder", {
        label: rootFolder.label,
        rootFolderId,
        driveId,
      });
      await crawl(rootFolderId);
    } catch (error) {
      console.log("[drive] failed root folder", {
        label: rootFolder.label,
        rootFolderId,
        driveId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}
