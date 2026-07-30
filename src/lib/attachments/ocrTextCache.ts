import { getPdfOcrMaxPages } from "@/lib/attachments/ocrPdfFallback";

// Cache for tesseract OCR output of scanned/image-only PDFs. A full OCR pass
// takes 45-80s per document; re-uploading the same file (byte-identical, keyed
// by sha256) should reuse the text already stored on a prior UploadedAttachment
// row instead of re-running the WASM worker.
//
// Reusing across owners is safe: an identical sha256 means identical bytes, and
// the OCR text is a pure function of those bytes — the requester already holds
// the exact file the cached text was derived from. Only text/pageCount are
// returned; no owner or case data.

/**
 * Stable prefix every OCR-recovered attachment text starts with. The cache
 * lookup matches on this prefix, so it must never change without a migration
 * plan for existing rows (annotatedCitationDensityEstimate also sniffs it).
 */
export const OCR_TEXT_MARKER = "[[OCR text recovered";

export const OCR_TEXT_HEADER =
  "[[OCR text recovered from a scanned/image-only PDF. Machine-read; verify figures against the source.]]";

const TRUNCATION_NOTE_REGEX =
  /\[\[OCR page limit reached: only the first (\d+) of (\d+) pages/;

/** Visible note appended when the page cap dropped trailing pages. */
export function buildOcrTruncationNote(pagesOcred: number, pagesTotal: number): string {
  const dropped = pagesTotal - pagesOcred;
  return `[[OCR page limit reached: only the first ${pagesOcred} of ${pagesTotal} pages were OCR'd. Text from the last ${dropped} page(s) is missing — totals or final line items may be absent. Raise PDF_OCR_MAX_PAGES to include them.]]`;
}

/**
 * Full attachment text for an OCR result: marker header, page text, and — when
 * the page cap dropped pages — a visible truncation note so the missing pages
 * are never silently absent from the reviewed set.
 */
export function buildOcrAttachmentText(ocr: {
  text: string;
  pagesOcred: number;
  pagesTotal?: number;
}): string {
  const parts = [OCR_TEXT_HEADER, ocr.text];
  if (typeof ocr.pagesTotal === "number" && ocr.pagesTotal > ocr.pagesOcred) {
    parts.push(buildOcrTruncationNote(ocr.pagesOcred, ocr.pagesTotal));
  }
  return parts.join("\n\n");
}

export function parseOcrTruncationNote(
  text: string
): { pagesOcred: number; pagesTotal: number } | null {
  const match = text.match(TRUNCATION_NOTE_REGEX);
  if (!match) return null;
  return {
    pagesOcred: Number.parseInt(match[1], 10),
    pagesTotal: Number.parseInt(match[2], 10),
  };
}

/**
 * A cached OCR text is reusable unless it was truncated by a page cap lower
 * than what the current cap would cover — re-running OCR then recovers pages
 * the cached run dropped (e.g. cache written under the old 10-page default,
 * current default 25).
 */
export function isCachedOcrTextReusable(
  text: string,
  maxPages: number = getPdfOcrMaxPages()
): boolean {
  const note = parseOcrTruncationNote(text);
  if (!note) return true;
  return note.pagesOcred >= Math.min(maxPages, note.pagesTotal);
}

/**
 * Look up OCR text a prior upload of the same bytes already produced. Never
 * throws — any lookup failure returns null so the caller just runs OCR as
 * before. Prisma is imported lazily so the pure helpers above stay usable
 * without a database.
 */
export async function findCachedOcrText(
  sha256: string
): Promise<{ text: string; pageCount?: number } | null> {
  if (!sha256) return null;
  try {
    const { prisma } = await import("@/lib/prisma");
    const rows = await prisma.uploadedAttachment.findMany({
      where: {
        sha256,
        text: { startsWith: OCR_TEXT_MARKER },
      },
      orderBy: { createdAt: "desc" },
      // A handful is enough to skip past stale truncated runs to a fuller one.
      take: 5,
      select: { text: true, pageCount: true },
    });

    const maxPages = getPdfOcrMaxPages();
    const hit = rows.find((row) => isCachedOcrTextReusable(row.text, maxPages));
    if (!hit) return null;
    return { text: hit.text, pageCount: hit.pageCount ?? undefined };
  } catch (error) {
    console.warn("[pdf-ocr-cache] lookup failed (non-blocking)", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
