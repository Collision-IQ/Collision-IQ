const EGNYTE_BASE_URL = process.env.EGNYTE_BASE_URL;
const EGNYTE_API_TOKEN = process.env.EGNYTE_API_TOKEN;

if (!EGNYTE_BASE_URL) {
  throw new Error("Missing EGNYTE_BASE_URL");
}

if (!EGNYTE_API_TOKEN) {
  throw new Error("Missing EGNYTE_API_TOKEN");
}

async function egnyteFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${EGNYTE_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${EGNYTE_API_TOKEN}`,
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