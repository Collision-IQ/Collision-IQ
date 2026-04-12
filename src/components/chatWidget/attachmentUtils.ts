export const MAX_UPLOAD_BATCH_FILES = 6;
export const UPLOAD_CAP_MESSAGE = "You can upload up to 6 files at once for now.";
export const MAX_UPLOAD_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_UPLOAD_TOTAL_BYTES = 75 * 1024 * 1024;

export type AttachmentSummaryItem = {
  filename: string;
  sizeBytes: number;
};

export type AttachmentKindInput = {
  mime: string;
  text: string;
  pageCount?: number;
};

export function buildAttachmentSummary(list: AttachmentSummaryItem[]) {
  if (!list.length) return "";
  if (list.length === 1) {
    return `Please analyze the attached file: ${list[0].filename}`;
  }

  return `Please analyze the attached files (${list.length}): ${list
    .map((attachment) => attachment.filename)
    .join(", ")}`;
}

export function isLikelyImageFile(file: Pick<File, "type">) {
  return file.type.startsWith("image/");
}

export function summarizeAttachmentStats(list: AttachmentSummaryItem[]) {
  return {
    fileCount: list.length,
    totalBytes: list.reduce((sum, attachment) => sum + attachment.sizeBytes, 0),
  };
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = unitIndex === 0 ? 0 : value >= 10 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export function validateUploadBatch(files: File[]) {
  if (files.length === 0) {
    return { valid: false, error: "No files selected." };
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const oversizedFile = files.find((file) => file.size > MAX_UPLOAD_FILE_BYTES);

  if (oversizedFile) {
    return {
      valid: false,
      error: `${oversizedFile.name} is ${formatBytes(oversizedFile.size)}. Max size is ${formatBytes(MAX_UPLOAD_FILE_BYTES)} per file.`,
      totalBytes,
    };
  }

  if (totalBytes > MAX_UPLOAD_TOTAL_BYTES) {
    return {
      valid: false,
      error: `Selected files total ${formatBytes(totalBytes)}. Max total upload size is ${formatBytes(MAX_UPLOAD_TOTAL_BYTES)} per batch.`,
      totalBytes,
    };
  }

  return {
    valid: true,
    totalBytes,
  };
}

export function formatAttachmentKind(attachment: AttachmentKindInput): string {
  if (attachment.mime === "application/pdf") {
    return attachment.pageCount
      ? `PDF (${attachment.pageCount} page${attachment.pageCount === 1 ? "" : "s"})`
      : "PDF";
  }
  if (attachment.mime.startsWith("image/")) return "Image";
  if (attachment.text?.trim()) return "Text";
  return attachment.mime || "Unknown";
}

export function buildAttachmentBatchStatus(
  files: Array<Pick<File, "type">>,
  verb: "attached" | "updated" | "uploading" | "analysis_starting"
): string {
  const imageCount = files.filter((file) => file.type.startsWith("image/")).length;
  const pdfCount = files.filter((file) => file.type === "application/pdf").length;
  const otherCount = files.length - imageCount - pdfCount;
  const parts = [
    imageCount > 0 ? `${imageCount} ${imageCount === 1 ? "photo" : "photos"}` : null,
    pdfCount > 0 ? `${pdfCount} ${pdfCount === 1 ? "PDF" : "PDFs"}` : null,
    otherCount > 0 ? `${otherCount} ${otherCount === 1 ? "file" : "files"}` : null,
  ].filter(Boolean) as string[];

  if (verb === "uploading") {
    return `Uploading & assessing ${files.length} ${files.length === 1 ? "file" : "files"}...`;
  }

  if (verb === "analysis_starting") {
    const lead = files.length === 1 ? "1 file attached" : `${files.length} files attached`;
    return `${lead}: ${parts.join(", ")}. Analysis starting.`;
  }

  if (files.length === 1) {
    return `1 file ${verb}.`;
  }

  return `${files.length} files ${verb}: ${parts.join(", ")}.`;
}
