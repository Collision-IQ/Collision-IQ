import type { UploadPlanLimits } from "@/lib/uploadSafety/uploadLimits";
import { formatUploadLimitBytes } from "@/lib/uploadSafety/uploadLimits";
import { isVideoExtension } from "@/lib/uploadSafety/videoSafety";

export const STANDARD_UPLOAD_ROUTE_MAX_BYTES = 8 * 1024 * 1024;

export type UploadTransport = "api-upload" | "direct-storage";

export type UploadTransportDecision = {
  uploadMode: UploadTransport;
  zipDetected: boolean;
  videoDetected: boolean;
  reason: string;
};

export type DirectUploadRejection = {
  filename: string;
  reason: string;
  code: string;
};

type FileLike = Pick<File, "name" | "type" | "size">;

const ZIP_MIME_TYPES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "multipart/x-zip",
]);

function getUploadExtension(filename: string) {
  const match = /\.[^.\\/]+$/.exec(filename);
  return match ? match[0].toLowerCase() : "";
}

function isZipUpload(file: Pick<File, "name" | "type">) {
  return getUploadExtension(file.name) === ".zip" || ZIP_MIME_TYPES.has((file.type || "").toLowerCase());
}

export function resolveUploadTransport(
  file: FileLike,
  limits: UploadPlanLimits
): UploadTransportDecision {
  const zipDetected = isZipUpload(file);
  const videoDetected = isVideoExtension(getUploadExtension(file.name));

  if (zipDetected || videoDetected || file.size > STANDARD_UPLOAD_ROUTE_MAX_BYTES) {
    return {
      uploadMode: "direct-storage",
      zipDetected,
      videoDetected,
      reason: zipDetected
        ? "zip_upload"
        : videoDetected
          ? "video_upload"
          : "large_file",
    };
  }

  return {
    uploadMode: "api-upload",
    zipDetected,
    videoDetected,
    reason: "small_file",
  };
}

export function validateDirectUploadCandidate(
  file: FileLike,
  limits: UploadPlanLimits
): DirectUploadRejection | null {
  const zipDetected = isZipUpload(file);
  const videoDetected = isVideoExtension(getUploadExtension(file.name));
  const maxBytes = zipDetected
    ? limits.maxZipCompressedBytes
    : videoDetected
      ? limits.maxVideoBytes
      : limits.maxUploadBytes;

  if (zipDetected && !limits.zipAllowed) {
    return {
      filename: file.name,
      reason: "ZIP uploads are available on Starter, Pro, and Admin plans.",
      code: "ZIP_PLAN_REQUIRED",
    };
  }

  if (videoDetected && !limits.videoAllowed) {
    return {
      filename: file.name,
      reason: "Video uploads are available on Pro and Admin plans.",
      code: "VIDEO_PLAN_REQUIRED",
    };
  }

  if (file.size > maxBytes) {
    return {
      filename: file.name,
      reason: zipDetected
        ? `ZIP archive exceeds ${formatUploadLimitBytes(limits.maxZipCompressedBytes)} plan limit.`
        : videoDetected
          ? `Video exceeds ${formatUploadLimitBytes(limits.maxVideoBytes)} plan limit.`
          : `File exceeds ${formatUploadLimitBytes(limits.maxUploadBytes)} plan limit.`,
      code: zipDetected ? "ZIP_TOO_LARGE" : "FILE_TOO_LARGE",
    };
  }

  return null;
}
