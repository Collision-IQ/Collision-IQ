type UnknownRecord = Record<string, unknown>;

const BLOCKED_KEYS = new Set([
  "rawText",
  "fullText",
  "documentText",
  "sourceText",
  "ocrText",
  "extractedText",
  "originalText",
  "verbatimText",
  "documentBlob",
  "fileBlob",
  "imageDataUrl",
  "pdfData",
  "previewUrl",
  "attachmentUrl",
  "downloadUrl",
  "base64",
  "binary",
  "pages",
  "fullDocument",
  "documentContent",
]);

function isPlainObject(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeUnsafeDocumentDump(value: unknown): boolean {
  if (typeof value !== "string") return false;

  const trimmed = value.trim();

  if (trimmed.length > 3000) return true;
  if (trimmed.includes("Page 1") && trimmed.length > 1000) return true;
  if (trimmed.includes("OEM") && trimmed.length > 4000) return true;

  return false;
}

export function sanitizeOutput<T>(input: T): T {
  if (Array.isArray(input)) {
    return input.map((item) => sanitizeOutput(item)) as T;
  }

  if (!isPlainObject(input)) {
    if (looksLikeUnsafeDocumentDump(input)) {
      return "[REDACTED_DOCUMENT_CONTENT]" as T;
    }
    return input;
  }

  const output: UnknownRecord = {};

  for (const [key, value] of Object.entries(input)) {
    if (BLOCKED_KEYS.has(key)) continue;

    if (looksLikeUnsafeDocumentDump(value)) {
      output[key] = "[REDACTED_DOCUMENT_CONTENT]";
      continue;
    }

    output[key] = sanitizeOutput(value);
  }

  return output as T;
}
