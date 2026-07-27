/**
 * Client side of the chunked server-relay upload (see
 * src/app/api/upload/chunked/route.ts). Used as the fallback when the
 * direct browser→Vercel-Blob upload fails: some environments cannot read the
 * blob API's responses (CORS), so every direct PUT reports as failed even
 * though the plain server route works — but that route caps out at ~4.5MB.
 * The relay slices the file into 4MB chunks that each fit through a server
 * function, then asks the server to assemble them into the final blob.
 */

export type ChunkedUploadResult = {
  url: string;
  downloadUrl: string;
  pathname: string;
  contentType: string;
};

/**
 * Stall watchdog for the direct browser→blob upload. In the CORS-blocked
 * mobile environment the blob client can retry PUTs without its promise ever
 * settling — the catch-based chunked-relay fallback then never fires and the
 * tray sits at UPLOADING forever. The guard rejects (and aborts the transfer)
 * once NO upload progress has been observed for `stallMs`; bytes actually
 * moving on a slow connection keep resetting the timer, so legitimate slow
 * uploads are never cut off.
 *
 * Usage:
 *   const guard = createUploadStallGuard();
 *   try {
 *     const uploadPromise = uploadBlob(..., {
 *       abortSignal: guard.abortSignal,
 *       onUploadProgress: guard.onUploadProgress,
 *     });
 *     uploadPromise.catch(() => {}); // the race may leave it as the loser
 *     blob = await Promise.race([uploadPromise, guard.stalled]);
 *   } catch { ...existing chunked-relay fallback... } finally { guard.finish(); }
 */
export function createUploadStallGuard(stallMs = 30_000): {
  abortSignal: AbortSignal;
  onUploadProgress: () => void;
  stalled: Promise<never>;
  finish: () => void;
} {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let settled = false;
  let rejectStalled: ((error: Error) => void) | undefined;
  const stalled = new Promise<never>((_, reject) => {
    rejectStalled = reject;
  });
  const bump = () => {
    if (settled) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      settled = true;
      controller.abort();
      rejectStalled?.(
        new Error(
          `Direct upload made no progress for ${Math.round(stallMs / 1000)}s (blob API unreachable) — falling back to the chunked relay.`
        )
      );
    }, stallMs);
  };
  const finish = () => {
    settled = true;
    if (timer) clearTimeout(timer);
  };
  bump();
  return { abortSignal: controller.signal, onUploadProgress: bump, stalled, finish };
}

export async function uploadFileViaChunkedRelay(
  file: File,
  options: {
    activeCaseId?: string | null;
    headers?: Record<string, string>;
    /**
     * Mint FRESH auth headers per relay request. Clerk session tokens expire
     * after ~60s, and when an Authorization header is present Clerk uses it
     * and ignores the (refreshed) session cookie — so a token captured before
     * the 30s direct-upload stall goes stale mid-relay on slow mobile
     * connections and every later chunk 401s ("No authenticated Clerk
     * session"). Prefer this over static `headers`.
     */
    getHeaders?: () => Promise<Record<string, string> | undefined>;
    onProgress?: (info: { sentChunks: number; totalChunks: number }) => void;
  } = {}
): Promise<ChunkedUploadResult> {
  const freshHeaders = async (): Promise<Record<string, string>> =>
    (options.getHeaders ? await options.getHeaders() : options.headers) ?? options.headers ?? {};
  const contentType = file.type || "application/octet-stream";

  const initRes = await fetch("/api/upload/chunked?action=init", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(await freshHeaders()) },
    body: JSON.stringify({ filename: file.name, contentType, sizeBytes: file.size }),
  });
  const init = (await initRes.json().catch(() => null)) as
    | { sessionId?: string; chunkBytes?: number; totalChunks?: number; error?: string }
    | null;
  if (!initRes.ok || !init?.sessionId || !init.chunkBytes || !init.totalChunks) {
    throw new Error(init?.error || "Chunked upload could not start.");
  }

  const { sessionId, chunkBytes, totalChunks } = init;
  for (let index = 0; index < totalChunks; index += 1) {
    const slice = file.slice(index * chunkBytes, Math.min((index + 1) * chunkBytes, file.size));
    const chunkRes = await fetch(
      `/api/upload/chunked?action=chunk&sessionId=${encodeURIComponent(sessionId)}&index=${index}`,
      {
        method: "POST",
        credentials: "include",
        // Re-mint auth per chunk: a multi-chunk relay on a slow connection
        // easily outlives a single Clerk token's ~60s validity.
        headers: { "Content-Type": "application/octet-stream", ...(await freshHeaders()) },
        body: slice,
      }
    );
    if (!chunkRes.ok) {
      const detail = (await chunkRes.json().catch(() => null)) as { error?: string } | null;
      throw new Error(detail?.error || `Chunk ${index + 1}/${totalChunks} failed to upload.`);
    }
    options.onProgress?.({ sentChunks: index + 1, totalChunks });
  }

  const assembleRes = await fetch("/api/upload/chunked?action=assemble", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(await freshHeaders()) },
    body: JSON.stringify({
      sessionId,
      filename: file.name,
      contentType,
      totalChunks,
      sizeBytes: file.size,
    }),
  });
  const assembled = (await assembleRes.json().catch(() => null)) as
    | (ChunkedUploadResult & { error?: string })
    | null;
  if (!assembleRes.ok || !assembled?.url || !assembled.pathname) {
    throw new Error(assembled?.error || "Chunked upload could not be assembled.");
  }
  return {
    url: assembled.url,
    downloadUrl: assembled.downloadUrl || assembled.url,
    pathname: assembled.pathname,
    contentType: assembled.contentType || contentType,
  };
}
