import type { AccountEntitlements } from "@/lib/billing/entitlements";

export const MB = 1024 * 1024;
export const FREE_UPLOAD_BATCH_FILE_LIMIT = 1;
export const STARTER_UPLOAD_BATCH_FILE_LIMIT = 10;
export const PRO_UPLOAD_BATCH_FILE_LIMIT = 150;
export const ADMIN_UPLOAD_BATCH_FILE_LIMIT = 1000;
export const FREE_MAX_UPLOAD_BYTES = 10 * MB;
export const STARTER_MAX_UPLOAD_BYTES = 25 * MB;
export const PRO_MAX_UPLOAD_BYTES = 100 * MB;
export const ADMIN_MAX_UPLOAD_BYTES = 500 * MB;
export const STARTER_MAX_EXTRACTED_BYTES = 100 * MB;
export const PRO_MAX_EXTRACTED_BYTES = 250 * MB;
export const ADMIN_MAX_EXTRACTED_BYTES = 2 * 1024 * MB;
export const PRO_MAX_VIDEO_BYTES = 50 * MB;
export const ADMIN_MAX_VIDEO_BYTES = 100 * MB;
export const VIDEO_MAX_DURATION_SECONDS_BY_PLAN = 5;
export const UNLIMITED_UPLOAD_BATCH_FILE_LIMIT = ADMIN_UPLOAD_BATCH_FILE_LIMIT;
export const FREE_UPLOAD_BATCH_LIMIT_MESSAGE =
  "Free accounts can upload 1 file per analysis. Please remove extra files and try again.";
export const VIDEO_UPLOAD_HINT = "Short videos up to 5 seconds are accepted for damage documentation.";
export const VIDEO_UPLOAD_ACCEPT =
  ".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm";

export const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".txt",
  ".docx",
  ".mp4",
  ".mov",
  ".webm",
]);

export const CCC_UPLOAD_EXTENSIONS = new Set([
  ".awf",
  ".ccc",
  ".xml",
  ".json",
  ".csv",
  ".dat",
  ".dbf",
  ".cfg",
  ".ini",
  ".log",
]);

export const BLOCKED_UPLOAD_EXTENSIONS = new Set([
  ".exe",
  ".bat",
  ".cmd",
  ".sh",
  ".js",
  ".html",
  ".php",
  ".dll",
  ".scr",
  ".msi",
  ".com",
  ".ps1",
  ".vbs",
  ".jar",
]);

export const SCREENSHOT_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".heic",
]);

export const VIDEO_UPLOAD_EXTENSIONS = new Set([".mp4", ".mov", ".webm"]);

export type UploadPlanLimits = {
  plan: "free" | "starter" | "trial" | "pro" | "admin";
  maxUploadBytes: number;
  maxFilesPerReview: number;
  zipAllowed: boolean;
  maxZipCompressedBytes: number;
  maxExtractedFiles: number;
  maxExtractedTotalBytes: number;
  maxZipNestingDepth: number;
  videoAllowed: boolean;
  maxVideoBytes: number;
  maxVideosPerReview: number;
  videoMaxDurationSeconds: number;
  cccWorkfileAllowed: boolean;
};

export function resolveUploadPlanLimits(
  entitlements: Pick<
    AccountEntitlements,
    "billingPlan" | "isPlatformAdmin" | "entitlementSource"
  > & { maxUploadsPerReview?: number | null; plan?: string; uploadCap?: number | null }
): UploadPlanLimits {
  if (entitlements.isPlatformAdmin === true) {
    return {
      plan: "admin",
      maxUploadBytes: ADMIN_MAX_UPLOAD_BYTES,
      maxFilesPerReview: entitlements.maxUploadsPerReview ?? ADMIN_UPLOAD_BATCH_FILE_LIMIT,
      zipAllowed: true,
      maxZipCompressedBytes: ADMIN_MAX_UPLOAD_BYTES,
      maxExtractedFiles: ADMIN_UPLOAD_BATCH_FILE_LIMIT,
      maxExtractedTotalBytes: ADMIN_MAX_EXTRACTED_BYTES,
      maxZipNestingDepth: 0,
      videoAllowed: true,
      maxVideoBytes: ADMIN_MAX_VIDEO_BYTES,
      maxVideosPerReview: ADMIN_UPLOAD_BATCH_FILE_LIMIT,
      videoMaxDurationSeconds: VIDEO_MAX_DURATION_SECONDS_BY_PLAN,
      cccWorkfileAllowed: true,
    };
  }

  if (
    entitlements.billingPlan === "pro" ||
    entitlements.billingPlan === "trial" ||
    entitlements.plan === "pro" ||
    entitlements.plan === "trial"
  ) {
    const plan =
      entitlements.billingPlan === "trial" || entitlements.plan === "trial"
        ? "trial"
        : "pro";

    return {
      plan,
      maxUploadBytes: PRO_MAX_UPLOAD_BYTES,
      maxFilesPerReview: entitlements.maxUploadsPerReview ?? PRO_UPLOAD_BATCH_FILE_LIMIT,
      zipAllowed: true,
      maxZipCompressedBytes: PRO_MAX_UPLOAD_BYTES,
      maxExtractedFiles: 200,
      maxExtractedTotalBytes: PRO_MAX_EXTRACTED_BYTES,
      maxZipNestingDepth: 0,
      videoAllowed: true,
      maxVideoBytes: PRO_MAX_VIDEO_BYTES,
      maxVideosPerReview: 3,
      videoMaxDurationSeconds: VIDEO_MAX_DURATION_SECONDS_BY_PLAN,
      cccWorkfileAllowed: plan === "pro",
    };
  }

  const isFreePlan =
    entitlements.billingPlan === "free" ||
    entitlements.plan === "free" ||
    entitlements.entitlementSource === "free" ||
    entitlements.billingPlan === "none" ||
    entitlements.plan === "none" ||
    entitlements.entitlementSource === "locked";

  if (isFreePlan) {
    return {
      plan: "free",
      maxUploadBytes: FREE_MAX_UPLOAD_BYTES,
      maxFilesPerReview: entitlements.maxUploadsPerReview ?? FREE_UPLOAD_BATCH_FILE_LIMIT,
      zipAllowed: false,
      maxZipCompressedBytes: 0,
      maxExtractedFiles: 0,
      maxExtractedTotalBytes: 0,
      maxZipNestingDepth: 0,
      videoAllowed: false,
      maxVideoBytes: 0,
      maxVideosPerReview: 0,
      videoMaxDurationSeconds: VIDEO_MAX_DURATION_SECONDS_BY_PLAN,
      cccWorkfileAllowed: false,
    };
  }

  return {
    plan: "starter",
    maxUploadBytes: STARTER_MAX_UPLOAD_BYTES,
    maxFilesPerReview: entitlements.maxUploadsPerReview ?? STARTER_UPLOAD_BATCH_FILE_LIMIT,
    zipAllowed: true,
    maxZipCompressedBytes: STARTER_MAX_UPLOAD_BYTES,
    maxExtractedFiles: 50,
    maxExtractedTotalBytes: STARTER_MAX_EXTRACTED_BYTES,
    maxZipNestingDepth: 0,
    videoAllowed: false,
    maxVideoBytes: 0,
    maxVideosPerReview: 0,
    videoMaxDurationSeconds: VIDEO_MAX_DURATION_SECONDS_BY_PLAN,
    cccWorkfileAllowed: false,
  };
}

export function formatUploadLimitBytes(bytes: number) {
  return `${Math.round(bytes / MB)}MB`;
}

export function getUploadBatchLimitMessage(
  limits: Pick<UploadPlanLimits, "maxFilesPerReview"> & { plan?: UploadPlanLimits["plan"] }
) {
  if (limits.plan === "admin") {
    return `You can upload up to ${limits.maxFilesPerReview} files per review.`;
  }

  if (limits.plan === "free" && limits.maxFilesPerReview === 1) {
    return FREE_UPLOAD_BATCH_LIMIT_MESSAGE;
  }

  if (limits.maxFilesPerReview === 1) {
    return "You can upload 1 file per review.";
  }

  return `You can upload up to ${limits.maxFilesPerReview} files at a time.`;
}

export function validateUploadBatchFileCount(
  fileCount: number,
  limits: Pick<UploadPlanLimits, "maxFilesPerReview">
) {
  const valid = fileCount <= limits.maxFilesPerReview;
  return {
    valid,
    code: valid ? null : "MAX_FILES_REACHED",
    reason: valid ? null : getUploadBatchLimitMessage(limits),
  };
}
