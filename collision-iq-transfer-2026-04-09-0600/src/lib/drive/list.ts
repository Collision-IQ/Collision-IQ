import { drive_v3 } from "googleapis";
import { getDriveImpersonationSubject } from "@/lib/drive/auth";

export type LabeledDriveFolder = {
  label: string;
  id: string;
};

const GOOGLE_DRIVE_URL_PATTERN = /^https?:\/\/(?:drive|docs)\.google\.com\//i;

function normalizeDriveIdentifier(params: {
  label: string;
  value?: string | null;
  kind: "driveId" | "folderId";
}): string | null {
  const trimmed = params.value?.trim();
  if (!trimmed) return null;

  if (GOOGLE_DRIVE_URL_PATTERN.test(trimmed)) {
    console.warn("[drive] invalid Google Drive identifier", {
      label: params.label,
      kind: params.kind,
      providedValue: trimmed,
      reason: "Expected a raw Google Drive ID, not a full URL.",
    });
    return null;
  }

  return trimmed;
}

function describeDriveEnvValueShape(value?: string | null): string {
  const trimmed = value?.trim();
  if (!trimmed) return "missing";
  if (GOOGLE_DRIVE_URL_PATTERN.test(trimmed)) return "url";
  if (/^[A-Za-z0-9_-]{10,}$/.test(trimmed)) return `raw_id(len=${trimmed.length})`;
  return `other(len=${trimmed.length})`;
}

function redactDriveIdentifier(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 8) return trimmed;
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

function getErrorStatus(error: unknown): unknown {
  if (typeof error === "object" && error && "code" in error) {
    return (error as { code?: unknown }).code;
  }

  return undefined;
}

export function getConfiguredDriveRootFolders(): LabeledDriveFolder[] {
  return [
    {
      label: "GOOGLE_OEM_PROCEDURES_FOLDER_ID",
      id: process.env.GOOGLE_OEM_PROCEDURES_FOLDER_ID,
    },
    {
      label: "GOOGLE_OEM_POSITION_STATEMENTS_FOLDER_ID",
      id: process.env.GOOGLE_OEM_POSITION_STATEMENTS_FOLDER_ID,
    },
    {
      label: "GOOGLE_PA_LAW_FOLDER_ID",
      id: process.env.GOOGLE_PA_LAW_FOLDER_ID,
    },
  ]
    .map((entry) => {
      const id = normalizeDriveIdentifier({
        label: entry.label,
        value: entry.id,
        kind: "folderId",
      });
      return id ? { label: entry.label, id } : null;
    })
    .filter((entry): entry is LabeledDriveFolder => Boolean(entry));
}

export async function listDriveFiles(
  drive: drive_v3.Drive,
  params: {
    driveId: string;
    rootFolderIds: Array<string | LabeledDriveFolder>;
  }
) {
  const normalizedDriveId = normalizeDriveIdentifier({
    label: "GOOGLE_SHARED_DRIVE_ID",
    value: params.driveId,
    kind: "driveId",
  });
  if (!normalizedDriveId) {
    throw new Error("Missing or invalid GOOGLE_SHARED_DRIVE_ID");
  }
  const driveId: string = normalizedDriveId;
  const impersonatedSubject = getDriveImpersonationSubject();

  const rootFolders = params.rootFolderIds
    .map((value) => (typeof value === "string" ? { label: "rootFolderId", id: value } : value))
    .map((value) => {
      const id = normalizeDriveIdentifier({
        label: value.label,
        value: value.id,
        kind: "folderId",
      });
      return id ? { ...value, id } : null;
    })
    .filter((value): value is LabeledDriveFolder => Boolean(value));

  if (rootFolders.length === 0) {
    throw new Error("No valid Google Drive root folder IDs configured");
  }

  const results: (drive_v3.Schema$File & { path?: string })[] = [];
  const seenFolders = new Set<string>();

  async function crawl(rootLabel: string, folderId: string, path = "") {
    if (seenFolders.has(folderId)) return;
    seenFolders.add(folderId);

    let pageToken: string | undefined;
    const q = `'${folderId}' in parents and trashed = false`;

    do {
      try {
        const res = await drive.files.list({
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
          label: rootLabel,
          driveId,
          folderId,
          probePassed: true,
          fileCount: res.data.files?.length ?? 0,
        });

        const files = res.data.files ?? [];

        for (const file of files) {
          if (!file.id || !file.name) continue;

          if (file.mimeType === "application/vnd.google-apps.folder") {
            await crawl(rootLabel, file.id, `${path}${file.name}/`);
          } else {
            results.push({
              ...file,
              path: `${path}${file.name}`
            });
          }
        }

        pageToken = res.data.nextPageToken ?? undefined;
      } catch (error) {
        console.log({
          operation: "list",
          label: rootLabel,
          driveId,
          folderId,
          probePassed: true,
          fileCount: 0,
          error: error instanceof Error ? error.message : String(error),
          status:
            typeof error === "object" && error && "code" in error
              ? (error as { code?: unknown }).code
              : undefined,
        });
        throw error;
      }
    } while (pageToken);
  }

  for (const rootFolder of rootFolders) {
    const rootFolderId = rootFolder.id;
    const rawEnvValue =
      rootFolder.label === "rootFolderId" ? rootFolderId : process.env[rootFolder.label];
    try {
      const probe = await drive.files.get({
        fileId: rootFolderId,
        supportsAllDrives: true,
        fields: "id,name,driveId,parents,mimeType",
      });
      console.log({
        operation: "probe",
        label: rootFolder.label,
        rawEnvValueShape: describeDriveEnvValueShape(rawEnvValue),
        rawEnvValueRedacted: redactDriveIdentifier(rawEnvValue),
        normalizedFolderId: rootFolderId,
        driveId,
        impersonatedSubject,
        folderId: rootFolderId,
        probePassed: true,
        fileCount: 0,
        metadata: probe.data,
      });
    } catch (error) {
      console.log({
        operation: "probe",
        label: rootFolder.label,
        rawEnvValueShape: describeDriveEnvValueShape(rawEnvValue),
        rawEnvValueRedacted: redactDriveIdentifier(rawEnvValue),
        normalizedFolderId: rootFolderId,
        driveId,
        impersonatedSubject,
        folderId: rootFolderId,
        probePassed: false,
        fileCount: 0,
        error: error instanceof Error ? error.message : String(error),
        status: getErrorStatus(error),
        hint: "check folder ID and subject access",
      });
      continue;
    }

    try {
      await crawl(rootFolder.label, rootFolderId);
    } catch (error) {
      console.log("[drive] failed root folder", {
        label: rootFolder.label,
        folderId: rootFolderId,
        driveId,
        probePassed: true,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}
