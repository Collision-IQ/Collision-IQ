import { del, get, issueSignedToken, list, presignUrl, put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { UnauthorizedError } from "@/lib/auth/require-current-user";
import { resolveUploadLimitsForCurrentUser } from "@/lib/uploadSafety/uploadEntitlements";
import { validateDirectUploadCandidate } from "@/lib/uploadSafety/directUploadRouting";

export const runtime = "nodejs";
// Assembly streams the chunk blobs back through the function into the final
// blob — allow enough time for large archives on slow storage days.
export const maxDuration = 300;

/**
 * Chunked server-relay upload.
 *
 * Direct browser→Vercel-Blob uploads fail in some environments (the blob API
 * response is not CORS-readable, so the SDK reports every PUT as failed), and
 * the plain server upload route cannot exceed the ~4.5MB serverless body
 * limit. This route relays large files in 4MB chunks:
 *
 *   init      → validate plan limits, mint a session
 *   chunk     → store each ≤4MB slice as a temp blob (server-side put)
 *   assemble  → stream the chunks back through the function into the final
 *               blob (multipart server put — no request-body limit applies),
 *               then delete the temp chunks
 *
 * Chunk pathnames are namespaced per user, so a session can only be assembled
 * by the user who created it.
 */

export const CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_CHUNKS = 250; // 1GB ceiling regardless of plan limits

function jsonError(error: string, code: string, status = 400) {
  return NextResponse.json({ error, code }, { status });
}

function chunkPrefix(userId: string, sessionId: string) {
  return `uploads/chunks/${userId}/${sessionId}/`;
}

function isSafeSessionId(value: string) {
  return /^[a-z0-9-]{10,64}$/i.test(value);
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "";

  try {
    const context = await resolveUploadLimitsForCurrentUser();
    if (!context.canUploadFiles) {
      return jsonError("Uploads are not included in your current plan.", "UPLOADS_NOT_INCLUDED", 403);
    }

    if (action === "init") {
      const body = (await request.json().catch(() => ({}))) as {
        filename?: unknown;
        contentType?: unknown;
        sizeBytes?: unknown;
      };
      const filename = typeof body.filename === "string" ? body.filename.trim() : "";
      const contentType =
        typeof body.contentType === "string" && body.contentType ? body.contentType : "application/octet-stream";
      const sizeBytes = Number.isFinite(body.sizeBytes) ? Number(body.sizeBytes) : 0;
      if (!filename || sizeBytes <= 0) {
        return jsonError("filename and sizeBytes are required.", "CHUNKED_INIT_INVALID");
      }

      const rejection = validateDirectUploadCandidate(
        { name: filename, type: contentType, size: sizeBytes },
        context.uploadLimits
      );
      if (rejection) {
        return jsonError(rejection.reason, rejection.code);
      }

      const totalChunks = Math.ceil(sizeBytes / CHUNK_BYTES);
      if (totalChunks > MAX_CHUNKS) {
        return jsonError("File is too large for chunked upload.", "CHUNKED_TOO_LARGE", 413);
      }

      const sessionId = globalThis.crypto.randomUUID();
      console.info("[upload-chunked] init", {
        uploadMode: "chunked-relay",
        filename,
        sizeBytes,
        totalChunks,
        plan: context.uploadLimits.plan,
      });
      return NextResponse.json({ sessionId, chunkBytes: CHUNK_BYTES, totalChunks });
    }

    if (action === "chunk") {
      const sessionId = url.searchParams.get("sessionId") || "";
      const index = Number(url.searchParams.get("index"));
      if (!isSafeSessionId(sessionId) || !Number.isInteger(index) || index < 0 || index >= MAX_CHUNKS) {
        return jsonError("Invalid chunk session or index.", "CHUNKED_CHUNK_INVALID");
      }
      const bytes = await request.arrayBuffer();
      if (!bytes.byteLength || bytes.byteLength > CHUNK_BYTES + 1024) {
        return jsonError("Chunk size out of range.", "CHUNKED_CHUNK_SIZE");
      }
      // The store is configured PRIVATE — public access is rejected outright.
      await put(`${chunkPrefix(context.user.id, sessionId)}${String(index).padStart(4, "0")}`, bytes, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/octet-stream",
        cacheControlMaxAge: 60 * 60,
      });
      return NextResponse.json({ ok: true, index });
    }

    if (action === "assemble") {
      const body = (await request.json().catch(() => ({}))) as {
        sessionId?: unknown;
        filename?: unknown;
        contentType?: unknown;
        totalChunks?: unknown;
        sizeBytes?: unknown;
      };
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
      const filename = typeof body.filename === "string" ? body.filename.trim() : "";
      const contentType =
        typeof body.contentType === "string" && body.contentType ? body.contentType : "application/octet-stream";
      const totalChunks = Number.isFinite(body.totalChunks) ? Number(body.totalChunks) : 0;
      const sizeBytes = Number.isFinite(body.sizeBytes) ? Number(body.sizeBytes) : 0;
      if (!isSafeSessionId(sessionId) || !filename || totalChunks <= 0 || totalChunks > MAX_CHUNKS) {
        return jsonError("Invalid assemble request.", "CHUNKED_ASSEMBLE_INVALID");
      }

      const prefix = chunkPrefix(context.user.id, sessionId);
      const listed = await list({ prefix, limit: MAX_CHUNKS + 10 });
      const chunks = listed.blobs
        .filter((blob) => /\/\d{4}$/.test(blob.pathname))
        .sort((a, b) => a.pathname.localeCompare(b.pathname));
      if (chunks.length !== totalChunks) {
        return jsonError(
          `Expected ${totalChunks} chunk(s) but found ${chunks.length}.`,
          "CHUNKED_ASSEMBLE_INCOMPLETE",
          409
        );
      }
      const assembledBytes = chunks.reduce((sum, blob) => sum + blob.size, 0);
      if (sizeBytes && Math.abs(assembledBytes - sizeBytes) > 1024) {
        return jsonError(
          `Assembled size ${assembledBytes} does not match expected ${sizeBytes}.`,
          "CHUNKED_ASSEMBLE_SIZE_MISMATCH",
          409
        );
      }

      // Stream chunk blobs back through the function into the final blob.
      // Chunks are PRIVATE (the store rejects public access), so read them
      // via the authenticated get() rather than raw URL fetches.
      const chunkUrls = chunks.map((blob) => blob.url);
      const chunkPathnames = chunks.map((blob) => blob.pathname);
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            for (const pathname of chunkPathnames) {
              const response = await get(pathname, { access: "private" });
              if (!response || response.statusCode !== 200 || !response.stream) {
                throw new Error(`Chunk read failed (${response?.statusCode ?? "null"}) for ${pathname}`);
              }
              const reader = response.stream.getReader();
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) controller.enqueue(value);
              }
            }
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });

      const blob = await put(`uploads/${Date.now()}-${filename}`, stream, {
        access: "private",
        addRandomSuffix: true,
        contentType,
        multipart: true,
      });

      // Best-effort cleanup of the temp chunks.
      await del(chunkUrls).catch((error) => {
        console.warn("[upload-chunked] chunk cleanup failed", {
          sessionId,
          message: error instanceof Error ? error.message : String(error),
        });
      });

      // The store is private, so blob.downloadUrl is not raw-fetchable — but
      // the finalize step downloads via a plain fetch(downloadUrl). Hand it a
      // presigned GET URL instead (valid for one hour).
      const signedToken = await issueSignedToken({
        pathname: blob.pathname,
        operations: ["get"],
        validUntil: Date.now() + 60 * 60 * 1000,
      });
      const { presignedUrl } = await presignUrl(signedToken, {
        operation: "get",
        pathname: blob.pathname,
        access: "private",
      });

      console.info("[upload-chunked] assembled", {
        uploadMode: "chunked-relay",
        filename,
        sizeBytes: assembledBytes,
        totalChunks,
        pathname: blob.pathname,
      });
      return NextResponse.json({
        url: blob.url,
        downloadUrl: presignedUrl,
        pathname: blob.pathname,
        contentType: blob.contentType,
      });
    }

    return jsonError("Unknown action.", "CHUNKED_ACTION_UNKNOWN");
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError(error.message, "UNAUTHORIZED", error.status);
    }
    const message = error instanceof Error ? error.message : "Chunked upload failed.";
    console.error("[upload-chunked] failed", { action, message });
    return jsonError(message, "CHUNKED_UPLOAD_FAILED", 500);
  }
}
