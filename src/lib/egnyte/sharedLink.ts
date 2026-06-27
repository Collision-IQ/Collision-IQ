/**
 * Retrieval for Egnyte share links (https://<org>.egnyte.com/fl/<linkId>) that shop estimates
 * embed to point at OEM procedures, scans, and supporting documents in Collision IQ's own DMS.
 *
 * A share link is resolved to its underlying file path via the Egnyte public links API, then the
 * file content is downloaded by path. Everything is guarded: when Egnyte is not configured for
 * the environment (no EGNYTE_BASE_URL / EGNYTE_API_TOKEN) or the link cannot be resolved, the
 * caller gets null and degrades gracefully — retrieval is *attempted*, never silently dropped.
 */

type EgnyteConfig = { baseUrl: string; token: string };

function getEgnyteConfig(): EgnyteConfig | null {
  const baseUrl = process.env.EGNYTE_BASE_URL?.trim();
  const token = process.env.EGNYTE_API_TOKEN?.trim();
  if (!baseUrl || !token) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), token };
}

export function isEgnyteConfigured(): boolean {
  return getEgnyteConfig() !== null;
}

/** Extracts the share-link id from an Egnyte `/fl/<id>` URL. Returns null for non-Egnyte URLs. */
export function extractEgnyteShareLinkId(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    if (host !== "egnyte.com" && !host.endsWith(".egnyte.com")) return null;
    const match = url.pathname.match(/\/fl\/([^/?#]+)/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

async function egnyteFetch(config: EgnyteConfig, path: string): Promise<Response> {
  const res = await fetch(`${config.baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${config.token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Egnyte API error ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
  return res;
}

function resolveLinkPath(linkJson: unknown): string | null {
  if (!linkJson || typeof linkJson !== "object") return null;
  const record = linkJson as Record<string, unknown>;
  if (typeof record.path === "string" && record.path.trim()) return record.path.trim();
  // Some responses nest the resolved targets under `links: [{ path }]`.
  if (Array.isArray(record.links)) {
    for (const entry of record.links) {
      if (entry && typeof entry === "object") {
        const path = (entry as Record<string, unknown>).path;
        if (typeof path === "string" && path.trim()) return path.trim();
      }
    }
  }
  return null;
}

export type EgnyteSharedDocument = {
  name: string;
  buffer: Buffer;
  mimeType: string | null;
};

/**
 * Resolves and downloads the file behind an Egnyte share link. Returns null when Egnyte is not
 * configured, the URL is not an Egnyte share link, or the link cannot be resolved to a file.
 */
export async function downloadEgnyteSharedLink(rawUrl: string): Promise<EgnyteSharedDocument | null> {
  const config = getEgnyteConfig();
  if (!config) return null;

  const linkId = extractEgnyteShareLinkId(rawUrl);
  if (!linkId) return null;

  const linkRes = await egnyteFetch(config, `/pubapi/v1/links/${encodeURIComponent(linkId)}`);
  const linkJson = await linkRes.json().catch(() => null);
  const filePath = resolveLinkPath(linkJson);
  if (!filePath) return null;

  const encodedPath = filePath
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const contentRes = await egnyteFetch(config, `/pubapi/v1/fs-content${encodedPath.startsWith("/") ? "" : "/"}${encodedPath}`);
  const buffer = Buffer.from(await contentRes.arrayBuffer());
  return {
    name: filePath.split("/").filter(Boolean).pop() ?? "Egnyte document",
    buffer,
    mimeType: contentRes.headers.get("content-type"),
  };
}
