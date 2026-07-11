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

export async function uploadFileViaChunkedRelay(
  file: File,
  options: {
    activeCaseId?: string | null;
    headers?: Record<string, string>;
    onProgress?: (info: { sentChunks: number; totalChunks: number }) => void;
  } = {}
): Promise<ChunkedUploadResult> {
  const baseHeaders = options.headers ?? {};
  const contentType = file.type || "application/octet-stream";

  const initRes = await fetch("/api/upload/chunked?action=init", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...baseHeaders },
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
        headers: { "Content-Type": "application/octet-stream", ...baseHeaders },
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
    headers: { "Content-Type": "application/json", ...baseHeaders },
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
