/**
 * The marker every OCR-recovered attachment text starts with.
 *
 * A leaf module (no imports) so pure parsers can tell machine-read text from a
 * real text layer without pulling the OCR pipeline (node:fs, pdf.js, canvas)
 * into their dependency graph. ocrTextCache re-exports these; the prefix is a
 * stored contract (the OCR cache matches rows on it) and must never change
 * without a migration.
 */
export const OCR_TEXT_MARKER = "[[OCR text recovered";

export const OCR_TEXT_HEADER =
  "[[OCR text recovered from a scanned/image-only PDF. Machine-read; verify figures against the source.]]";

/** The text is OCR output (it opens with the marker), not a document's own text layer. */
export function isOcrRecoveredText(text: string | null | undefined): boolean {
  return (text ?? "").trimStart().startsWith(OCR_TEXT_MARKER);
}
