import {
  VIDEO_DURATION_LIMIT_MESSAGE,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_DURATION_SECONDS,
  isVideoMimeType,
} from "@/lib/uploadSafety/videoSafety";

export const MAX_UPLOAD_FILE_BYTES = 50 * 1024 * 1024;

export type AttachmentSummaryItem = {
  filename: string;
  sizeBytes: number;
};

export type AttachmentCompactSummaryItem = {
  filename: string;
  mime?: string;
  source?: string;
  hasVision?: boolean;
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

export function isLikelyVideoFile(file: Pick<File, "name" | "type">) {
  return (
    isVideoMimeType(file.type) ||
    /\.(?:mp4|mov|webm)$/i.test(file.name)
  );
}

export function summarizeAttachmentStats(list: AttachmentSummaryItem[]) {
  return {
    fileCount: list.length,
    totalBytes: list.reduce((sum, attachment) => sum + attachment.sizeBytes, 0),
  };
}

export function buildCompactAttachmentSummary(list: AttachmentCompactSummaryItem[]) {
  const totalCount = list.length;
  const pdfCount = list.filter(isPdfAttachment).length;
  const photoCount = list.filter((attachment) => !isPdfAttachment(attachment) && isPhotoAttachment(attachment)).length;
  const videoCount = list.filter(isVideoAttachment).length;
  const otherCount = Math.max(0, totalCount - photoCount - pdfCount - videoCount);
  const parts = [
    `${totalCount} ${totalCount === 1 ? "file" : "files"} uploaded`,
    photoCount > 0 ? `${photoCount} ${photoCount === 1 ? "photo" : "photos"}` : null,
    pdfCount > 0 ? `${pdfCount} ${pdfCount === 1 ? "PDF" : "PDFs"}` : null,
    videoCount > 0 ? `${videoCount} ${videoCount === 1 ? "video" : "videos"}` : null,
    otherCount > 0 ? `${otherCount} ${otherCount === 1 ? "other file" : "other files"}` : null,
  ].filter(Boolean);

  return parts.join(" · ");
}

function isPhotoAttachment(attachment: AttachmentCompactSummaryItem) {
  const mime = attachment.mime ?? "";
  const filename = attachment.filename ?? "";
  return (
    attachment.source === "camera" ||
    mime.startsWith("image/") ||
    /\.(?:png|jpe?g|webp|gif|heic|heif)$/i.test(filename)
  );
}

function isPdfAttachment(attachment: AttachmentCompactSummaryItem) {
  const mime = attachment.mime ?? "";
  const filename = attachment.filename ?? "";
  return mime === "application/pdf" || /\.pdf$/i.test(filename);
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

  const oversizedFile = files.find((file) => file.size > MAX_UPLOAD_FILE_BYTES);

  if (oversizedFile) {
    return {
      valid: false,
      error: `${oversizedFile.name} is ${formatBytes(oversizedFile.size)}. Max size is ${formatBytes(MAX_UPLOAD_FILE_BYTES)} per file.`,
      totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    };
  }

  return {
    valid: true,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
  };
}

function isVideoAttachment(attachment: AttachmentCompactSummaryItem) {
  const mime = attachment.mime ?? "";
  const filename = attachment.filename ?? "";
  return mime.startsWith("video/") || /\.(?:mp4|mov|webm)$/i.test(filename);
}

export async function validateSelectedVideoDurations(files: File[]) {
  const failures: Array<{ filename: string; reason: string; code: string }> = [];

  await Promise.all(
    files.filter(isLikelyVideoFile).map(async (file) => {
      if (file.size > VIDEO_MAX_BYTES) {
        failures.push({
          filename: file.name,
          reason: `Video is ${formatBytes(file.size)}. Max size is ${formatBytes(VIDEO_MAX_BYTES)} unless your plan limit is lower.`,
          code: "FILE_TOO_LARGE",
        });
        return;
      }

      const duration = await readBrowserVideoDuration(file);
      if (duration !== null && duration > VIDEO_MAX_DURATION_SECONDS) {
        failures.push({
          filename: file.name,
          reason: VIDEO_DURATION_LIMIT_MESSAGE,
          code: "VIDEO_TOO_LONG",
        });
      }
    })
  );

  return failures;
}

function readBrowserVideoDuration(file: File): Promise<number | null> {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);
    let settled = false;

    const finish = (duration: number | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute("src");
      video.load();
      resolve(duration);
    };

    video.preload = "metadata";
    video.onloadedmetadata = () => {
      finish(Number.isFinite(video.duration) ? video.duration : null);
    };
    video.onerror = () => finish(null);
    video.src = objectUrl;
  });
}

export function formatAttachmentKind(attachment: AttachmentKindInput): string {
  if (attachment.mime === "application/pdf") {
    return attachment.pageCount
      ? `PDF (${attachment.pageCount} page${attachment.pageCount === 1 ? "" : "s"})`
      : "PDF";
  }
  if (attachment.mime.startsWith("image/")) return "Image";
  if (attachment.mime.startsWith("video/")) return "Video";
  if (attachment.text?.trim()) return "Text";
  return attachment.mime || "Unknown";
}

export function buildAttachmentBatchStatus(
  files: Array<Pick<File, "type">>,
  verb: "attached" | "updated" | "uploading" | "analysis_starting"
): string {
  const imageCount = files.filter((file) => file.type.startsWith("image/")).length;
  const pdfCount = files.filter((file) => file.type === "application/pdf").length;
  const videoCount = files.filter((file) => file.type.startsWith("video/")).length;
  const otherCount = files.length - imageCount - pdfCount - videoCount;
  const parts = [
    imageCount > 0 ? `${imageCount} ${imageCount === 1 ? "photo" : "photos"}` : null,
    pdfCount > 0 ? `${pdfCount} ${pdfCount === 1 ? "PDF" : "PDFs"}` : null,
    videoCount > 0 ? `${videoCount} ${videoCount === 1 ? "video" : "videos"}` : null,
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
