import type { AccountEntitlements } from "@/lib/billing/entitlements";

export const MB = 1024 * 1024;
export const STARTER_UPLOAD_BATCH_FILE_LIMIT = 1;
export const PRO_UPLOAD_BATCH_FILE_LIMIT = 6;
export const ADMIN_UPLOAD_BATCH_FILE_LIMIT = 50;
export const UNLIMITED_UPLOAD_BATCH_FILE_LIMIT = Number.MAX_SAFE_INTEGER;
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
  maxExtractedFiles: number;
  maxExtractedTotalBytes: number;
  maxZipNestingDepth: number;
  cccWorkfileAllowed: boolean;
};

export function resolveUploadPlanLimits(
  entitlements: Pick<
    AccountEntitlements,
    "billingPlan" | "isPlatformAdmin" | "entitlementSource"
  > & { maxUploadsPerReview?: number | null; plan?: string; uploadCap?: number | null }
): UploadPlanLimits {
  if (
    entitlements.isPlatformAdmin ||
    entitlements.uploadCap === null ||
    entitlements.entitlementSource === "free_access_admin"
  ) {
    return {
      plan: "admin",
      maxUploadBytes: 50 * MB,
      maxFilesPerReview: entitlements.maxUploadsPerReview ?? UNLIMITED_UPLOAD_BATCH_FILE_LIMIT,
      zipAllowed: true,
      maxExtractedFiles: 50,
      maxExtractedTotalBytes: 200 * MB,
      maxZipNestingDepth: 0,
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
      maxUploadBytes: 30 * MB,
      maxFilesPerReview: entitlements.maxUploadsPerReview ?? PRO_UPLOAD_BATCH_FILE_LIMIT,
      zipAllowed: true,
      maxExtractedFiles: 50,
      maxExtractedTotalBytes: 200 * MB,
      maxZipNestingDepth: 0,
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

  return {
    plan: isFreePlan ? "free" : "starter",
    maxUploadBytes: 10 * MB,
    maxFilesPerReview: entitlements.maxUploadsPerReview ?? STARTER_UPLOAD_BATCH_FILE_LIMIT,
    zipAllowed: false,
    maxExtractedFiles: 0,
    maxExtractedTotalBytes: 0,
    maxZipNestingDepth: 0,
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
    return "You can upload any number of files per review.";
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
