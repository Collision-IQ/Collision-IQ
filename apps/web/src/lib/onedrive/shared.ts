import mammoth from "mammoth";
import pdf from "pdf-parse";

export type OneDriveSourceType = "onedrive1" | "onedrive2";

export type OneDriveFile = {
  id: string;
  name: string;
  path: string;
  lastModifiedDateTime: string;
  mimeType?: string | null;
  downloadUrl?: string | null;
};

type OneDriveEnvConfig = {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  refreshToken: string;
  driveId?: string;
};

type AccessTokenResponse = {
  access_token: string;
};

function getConfig(prefix: "ONEDRIVE_1" | "ONEDRIVE_2"): OneDriveEnvConfig {
  const clientId = process.env[`${prefix}_CLIENT_ID`] ?? "";
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`] ?? "";
  const tenantId = process.env[`${prefix}_TENANT_ID`] ?? "common";
  const refreshToken = process.env[`${prefix}_REFRESH_TOKEN`] ?? "";
  const driveId = process.env[`${prefix}_DRIVE_ID`];

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(`Missing OneDrive credentials for ${prefix}`);
  }

  return {
    clientId,
    clientSecret,
    tenantId,
    refreshToken,
    driveId,
  };
}

export async function refreshOneDriveToken(prefix: "ONEDRIVE_1" | "ONEDRIVE_2") {
  const config = getConfig(prefix);
  const response = await fetch(
    `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "refresh_token",
        refresh_token: config.refreshToken,
        scope: "Files.Read.All offline_access",
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`OneDrive token refresh failed for ${prefix}`);
  }

  const data = (await response.json()) as AccessTokenResponse;
  return data.access_token;
}

export function createOneDriveClient(prefix: "ONEDRIVE_1" | "ONEDRIVE_2") {
  const config = getConfig(prefix);

  return {
    async getAccessToken() {
      return refreshOneDriveToken(prefix);
    },
    async api(path: string, init?: RequestInit) {
      const token = await refreshOneDriveToken(prefix);
      const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
      });

      if (!response.ok) {
        throw new Error(`OneDrive request failed for ${path}`);
      }

      return response;
    },
    driveId: config.driveId,
  };
}

export async function listOneDriveFiles(client: {
  api: (path: string, init?: RequestInit) => Promise<Response>;
  driveId?: string;
}): Promise<OneDriveFile[]> {
  const basePath = client.driveId
    ? `/drives/${client.driveId}/root/search(q='')?$top=200&select=id,name,file,lastModifiedDateTime,parentReference,@microsoft.graph.downloadUrl`
    : `/me/drive/root/search(q='')?$top=200&select=id,name,file,lastModifiedDateTime,parentReference,@microsoft.graph.downloadUrl`;
  const response = await client.api(basePath);
  const data = (await response.json()) as {
    value?: Array<{
      id?: string;
      name?: string;
      lastModifiedDateTime?: string;
      file?: { mimeType?: string };
      parentReference?: { path?: string };
      "@microsoft.graph.downloadUrl"?: string;
    }>;
  };

  return (data.value ?? [])
    .filter((item) => item.id && item.name && item.file)
    .map((item) => ({
      id: item.id!,
      name: item.name!,
      path: `${item.parentReference?.path ?? ""}/${item.name ?? ""}`.replace(
        /\/+/g,
        "/"
      ),
      lastModifiedDateTime: item.lastModifiedDateTime ?? new Date().toISOString(),
      mimeType: item.file?.mimeType ?? null,
      downloadUrl: item["@microsoft.graph.downloadUrl"] ?? null,
    }));
}

export async function extractOneDriveText(file: OneDriveFile): Promise<string> {
  if (!file.downloadUrl) {
    return "";
  }

  const response = await fetch(file.downloadUrl);
  if (!response.ok) {
    return "";
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const mime = file.mimeType ?? "";

  if (mime === "application/pdf") {
    const parsed = await pdf(buffer);
    return parsed.text || "";
  }

  if (
    mime ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || "";
  }

  if (mime.startsWith("text/")) {
    return buffer.toString("utf8");
  }

  return "";
}

export async function ingestOneDriveSource(params: {
  client: ReturnType<typeof createOneDriveClient>;
  sourceType: OneDriveSourceType;
  ingestDocument: (params: {
    fileId: string;
    text: string;
    path: string;
    modifiedTime: string;
    sourceType: OneDriveSourceType;
  }) => Promise<number>;
}) {
  const files = await listOneDriveFiles(params.client);
  let indexed = 0;
  let skipped = 0;

  for (const file of files) {
    const text = await extractOneDriveText(file);

    if (!text.trim()) {
      skipped += 1;
      continue;
    }

    const chunkCount = await params.ingestDocument({
      fileId: file.id,
      text,
      path: file.path,
      modifiedTime: file.lastModifiedDateTime,
      sourceType: params.sourceType,
    });

    if (chunkCount > 0) {
      indexed += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    indexed,
    skipped,
    total: files.length,
  };
}
