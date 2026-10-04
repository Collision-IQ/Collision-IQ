/**
 * Report PDFs any server instance can serve.
 *
 * A built Delta report used to live only in the memory of the instance that
 * built it (putAnnotatedEstimateExport, 30 minutes). Its download link worked
 * only when that same warm instance answered, so the route also embedded every
 * PDF in its JSON response as a fallback, and Vercel refuses a serverless
 * response over 4.5 MB. RO 21548's response was 3.68 MB for a 12-page
 * comparison estimate, 85% of it the Citation Density copy.
 *
 * Each PDF is now also written to the PRIVATE Blob store under its owner's
 * id. The download route serves it from there when the instance's memory does
 * not have it, and the response leaves a stored PDF out when keeping it inline
 * would push the response past the budget. A link only ever reads its owner's
 * files. Stored reports are kept for RETENTION_DAYS, then pruned on the
 * owner's next save.
 */
import { del, get, list, put } from "@vercel/blob";

/** The ids putAnnotatedEstimateExport mints (randomUUID). Nothing else becomes a path. */
const EXPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const RETENTION_DAYS = 7;

/** Comfortably under Vercel's 4.5 MB serverless response limit. */
export const RESPONSE_BUDGET_BYTES = 3_500_000;

const ownerPrefix = (ownerUserId: string) => `reports/delta/${encodeURIComponent(ownerUserId)}/`;

export function reportExportPathname(ownerUserId: string, exportId: string): string | null {
  if (!ownerUserId || !EXPORT_ID.test(exportId)) return null;
  return `${ownerPrefix(ownerUserId)}${exportId.toLowerCase()}.pdf`;
}

export function reportExportStoreConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/**
 * Writes the PDFs and returns the ids that were stored. A write that fails is
 * logged and left out of the set: the caller keeps that PDF in its response.
 */
export async function saveReportExports(
  ownerUserId: string,
  exports: Array<{ exportId: string; bytes: Uint8Array }>
): Promise<Set<string>> {
  const stored = new Set<string>();
  if (!reportExportStoreConfigured()) return stored;
  await Promise.all(
    exports.map(async ({ exportId, bytes }) => {
      const pathname = reportExportPathname(ownerUserId, exportId);
      if (!pathname) return;
      try {
        await put(pathname, Buffer.from(bytes), { access: "private", contentType: "application/pdf", addRandomSuffix: false });
        stored.add(exportId);
      } catch (error) {
        console.warn("[report-export-store] write failed", { exportId, message: error instanceof Error ? error.message : String(error) });
      }
    })
  );
  await pruneOldReportExports(ownerUserId);
  return stored;
}

/** The owner's stored PDF as a stream, or null when there is none. */
export async function readReportExport(ownerUserId: string, exportId: string): Promise<ReadableStream<Uint8Array> | null> {
  if (!reportExportStoreConfigured()) return null;
  const pathname = reportExportPathname(ownerUserId, exportId);
  if (!pathname) return null;
  try {
    const result = await get(pathname, { access: "private" });
    return result && result.statusCode === 200 && result.stream ? result.stream : null;
  } catch (error) {
    console.warn("[report-export-store] read failed", { exportId, message: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

async function pruneOldReportExports(ownerUserId: string): Promise<void> {
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const { blobs } = await list({ prefix: ownerPrefix(ownerUserId), limit: 100 });
    const expired = blobs.filter((blob) => new Date(blob.uploadedAt).getTime() < cutoff).map((blob) => blob.url);
    if (expired.length) await del(expired);
  } catch (error) {
    console.warn("[report-export-store] prune failed", { message: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Which inline PDFs to leave out so the response fits the budget: only PDFs
 * the store holds (their link serves them), largest first, and only as many
 * as it takes. A response already under the budget keeps every PDF inline,
 * exactly as before.
 */
export function inlinePdfsToDrop(params: {
  responseBytes: number;
  inline: Array<{ id: string; base64Length: number }>;
  stored: ReadonlySet<string>;
  budget?: number;
}): Set<string> {
  const budget = params.budget ?? RESPONSE_BUDGET_BYTES;
  const drop = new Set<string>();
  let bytes = params.responseBytes;
  const candidates = params.inline.filter((pdf) => params.stored.has(pdf.id)).sort((a, b) => b.base64Length - a.base64Length);
  for (const pdf of candidates) {
    if (bytes <= budget) break;
    drop.add(pdf.id);
    bytes -= pdf.base64Length;
  }
  return drop;
}

/** A download name safe to put in a Content-Disposition header. */
export function safePdfFilename(name: string | null | undefined, fallback: string): string {
  const cleaned = (name ?? "").replace(/[^\w .()-]+/g, "").replace(/\s+/g, " ").trim().slice(0, 150);
  if (!cleaned) return fallback;
  return /\.pdf$/i.test(cleaned) ? cleaned : `${cleaned}.pdf`;
}
