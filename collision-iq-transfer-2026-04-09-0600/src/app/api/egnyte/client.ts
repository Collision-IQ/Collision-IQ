function getEgnyteConfig() {
  const baseUrl = process.env.EGNYTE_BASE_URL;
  const token = process.env.EGNYTE_API_TOKEN;

  if (!baseUrl) {
    throw new Error("Missing EGNYTE_BASE_URL");
  }

  if (!token) {
    throw new Error("Missing EGNYTE_API_TOKEN");
  }

  return {
    baseUrl,
    token,
  };
}

async function egnyteFetch(path: string, init?: RequestInit) {
  const config = getEgnyteConfig();
  const res = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Egnyte API error ${res.status}: ${text}`);
  }

  return res;
}

export type EgnyteFileMetadata = {
  name: string;
  path: string;
  is_folder?: boolean;
  object_type?: string;
  last_modified?: string;
  checksum?: string;
  entry_id?: string;
};

export async function getEgnyteMetadata(
  egnytePath: string
): Promise<EgnyteFileMetadata> {
  const encodedPath = egnytePath
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  const res = await egnyteFetch(`/pubapi/v1/fs${encodedPath}`);
  return res.json();
}

export async function downloadEgnyteFile(
  egnytePath: string
): Promise<ArrayBuffer> {
  const encodedPath = egnytePath
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  const res = await egnyteFetch(`/pubapi/v1/fs-content${encodedPath}`);
  return res.arrayBuffer();
}
