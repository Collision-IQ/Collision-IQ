import pdfParse from "pdf-parse";
import mammoth from "mammoth";

const MAX_REUSABLE_DATA_URL_BYTES = 4 * 1024 * 1024;

export async function extractPreviewDataFromBuffer(params: {
  buffer: Buffer;
  mimeType?: string | null;
  filename?: string | null;
}): Promise<{
  text: string;
  pageCount?: number;
}> {
  const mimeType = (params.mimeType || "").toLowerCase();

  if (mimeType.includes("text")) {
    return { text: params.buffer.toString("utf8") };
  }

  if (mimeType === "application/pdf") {
    const result = await pdfParse(params.buffer);
    return {
      text: result.text || "",
      pageCount: typeof result.numpages === "number" ? result.numpages : undefined,
    };
  }

  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
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
