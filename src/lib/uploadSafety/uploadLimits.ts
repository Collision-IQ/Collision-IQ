import type { AccountEntitlements } from "@/lib/billing/entitlements";

export const MB = 1024 * 1024;

export const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".txt",
  ".docx",
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
]);

export const SCREENSHOT_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".heic",
]);

export type UploadPlanLimits = {
  plan: "starter" | "trial" | "pro" | "admin";
  maxUploadBytes: number;
  maxFilesPerReview: number | null;
  zipAllowed: boolean;
  maxExtractedFiles: number;
  maxExtractedTotalBytes: number;
  maxZipNestingDepth: number;
};

export function resolveUploadPlanLimits(
  entitlements: Pick<
    AccountEntitlements,
    "plan" | "billingPlan" | "isPlatformAdmin" | "entitlementSource"
  >
): UploadPlanLimits {
  if (
    entitlements.isPlatformAdmin ||
    entitlements.plan === "admin" ||
    entitlements.entitlementSource === "free_access_admin"
  ) {
    return {
      plan: "admin",
      maxUploadBytes: 50 * MB,
      maxFilesPerReview: null,
      zipAllowed: true,
      maxExtractedFiles: 50,
      maxExtractedTotalBytes: 150 * MB,
      maxZipNestingDepth: 2,
    };
  }

  if (
    entitlements.billingPlan === "pro" ||
    entitlements.billingPlan === "trial" ||
    entitlements.plan === "pro" ||
    entitlements.plan === "trial"
  ) {
    return {
      plan: entitlements.billingPlan === "trial" || entitlements.plan === "trial" ? "trial" : "pro",
      maxUploadBytes: 30 * MB,
      maxFilesPerReview: null,
      zipAllowed: true,
      maxExtractedFiles: 25,
      maxExtractedTotalBytes: 75 * MB,
      maxZipNestingDepth: 2,
    };
  }

  return {
    plan: "starter",
    maxUploadBytes: 10 * MB,
    maxFilesPerReview: 1,
    zipAllowed: false,
    maxExtractedFiles: 0,
    maxExtractedTotalBytes: 0,
    maxZipNestingDepth: 0,
  };
}

export function formatUploadLimitBytes(bytes: number) {
  return `${Math.round(bytes / MB)}MB`;
}
