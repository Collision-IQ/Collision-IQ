import { createHash } from "node:crypto";
import pdfParse from "pdf-parse";
import { ocrPdfBuffer, shouldOcrPdf } from "@/lib/attachments/ocrPdfFallback";
import {
  buildOcrAttachmentText,
  findCachedOcrText,
} from "@/lib/attachments/ocrTextCache";

const MAX_REUSABLE_DATA_URL_BYTES = 4 * 1024 * 1024;

/**
 * Some estimate writers emit PDFs with a malformed cross-reference structure
 * (no trailer dictionary) that strict pdf.js builds refuse with
 * InvalidPDFException even though every object is intact — a live USAA SOR
 * did exactly this. A pdf-lib load→save round-trip rewrites the document
 * with a well-formed xref, after which parsing succeeds with identical text.
 * Only on repeated failure does the upload fail, and then with a message a
 * person can act on rather than a parser exception.
 */
async function parsePdfWithRepair(
  buffer: Buffer,
  filename?: string | null
): Promise<{ text: string; numpages?: number }> {
  try {
    return await pdfParse(buffer);
  } catch (firstError) {
    try {
      const { PDFDocument } = await import("pdf-lib");
      const doc = await PDFDocument.load(buffer, {
        ignoreEncryption: true,
        throwOnInvalidObject: false,
        updateMetadata: false,
      });
      const repaired = Buffer.from(await doc.save());
      const result = await pdfParse(repaired);
      console.info("[pdf-repair] structurally repaired PDF parsed successfully", {
        filename: filename ?? null,
        originalBytes: buffer.byteLength,
        repairedBytes: repaired.byteLength,
        pages: result.numpages,
      });
      return result;
    } catch {
      console.error("[pdf-repair] PDF unreadable even after structural repair", {
        filename: filename ?? null,
        sizeBytes: buffer.byteLength,
        error: firstError instanceof Error ? firstError.message : String(firstError),
      });
      throw new Error(
        `${filename ?? "This PDF"} could not be read — the file appears corrupted, password-protected, or uses an unsupported format. Re-download or re-export the PDF and upload it again.`
      );
    }
  }
}

export async function extractPreviewDataFromBuffer(params: {
  buffer: Buffer;
  mimeType?: string | null;
  filename?: string | null;
}): Promise<{
  text: string;
  pageCount?: number;
  /** Set when the OCR fallback ran — callers persist it so the OCR cache can hit. */
  sha256?: string;
}> {
  const mimeType = (params.mimeType || "").toLowerCase();

  if (mimeType.includes("text")) {
    return { text: params.buffer.toString("utf8") };
  }

  if (mimeType.startsWith("image/")) {
    return {
      text: `[[Image attached for visual analysis: ${params.filename || "uploaded image"}. OCR text was not extracted, but the image remains available for screenshot/photo review.]]`,
    };
  }

  if (mimeType.startsWith("video/")) {
    return {
      text: `[[Short video accepted for damage documentation: ${params.filename || "uploaded video"}. Video files are stored as evidence; still images remain preferred for direct AI visual analysis.]]`,
    };
  }

  if (mimeType === "application/pdf") {
    const result = await parsePdfWithRepair(params.buffer, params.filename);
    const text = result.text || "";
    const pageCount = typeof result.numpages === "number" ? result.numpages : undefined;

    // Image-only ("scanned") PDF: no text layer. Fall back to server-side OCR so
    // the estimate text still reaches the reviewed set and the line extractors.
    if (shouldOcrPdf(text, pageCount)) {
      // Keyed by content hash: a re-upload of the same bytes reuses the OCR
      // text a prior UploadedAttachment row stored, skipping the 45-80s pass.
      const sha256 = createHash("sha256").update(params.buffer).digest("hex");
      const cached = await findCachedOcrText(sha256);
      if (cached) {
        console.info("[pdf-ocr-cache] reused OCR text from prior upload", {
          sha256,
          filename: params.filename ?? null,
        });
        return { text: cached.text, pageCount: pageCount ?? cached.pageCount, sha256 };
      }

      const ocr = await ocrPdfBuffer(params.buffer);
      if (ocr && ocr.text.replace(/\s+/g, " ").trim().length > text.replace(/\s+/g, " ").trim().length) {
        return { text: buildOcrAttachmentText(ocr), pageCount, sha256 };
      }
      return { text, pageCount, sha256 };
    }

    return { text, pageCount };
  }

  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: params.buffer });
    return { text: result.value || "" };
  }

  return {
    text: `[[Unsupported file type for text extraction: ${mimeType || "unknown type"}: ${params.filename || "unknown file"}]]`,
  };
}

export async function extractPreviewDataFromFile(file: File): Promise<{
  text: string;
  pageCount?: number;
  sha256?: string;
}> {
  const buffer = Buffer.from(await file.arrayBuffer());
  return extractPreviewDataFromBuffer({
    buffer,
    mimeType: file.type,
    filename: file.name,
  });
}

export async function fileToReusableDataUrl(file: File): Promise<string | undefined> {
  const buffer = Buffer.from(await file.arrayBuffer());
  return bufferToReusableDataUrl({
    buffer,
    mimeType: file.type,
  });
}

export function bufferToReusableDataUrl(params: {
  buffer: Buffer;
  mimeType?: string | null;
  maxBytes?: number;
}): string | undefined {
  const mimeType = (params.mimeType || "").toLowerCase();
  const maxBytes = params.maxBytes ?? MAX_REUSABLE_DATA_URL_BYTES;

  if (!mimeType.startsWith("image/") && mimeType !== "application/pdf") {
    return undefined;
  }

  if (params.buffer.byteLength > maxBytes) {
    return undefined;
  }

  return `data:${mimeType};base64,${params.buffer.toString("base64")}`;
}
