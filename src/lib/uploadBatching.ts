import { STARTER_UPLOAD_BATCH_FILE_LIMIT } from "@/lib/uploadSafety/uploadLimits";

export const NEXT_UPLOAD_PRIORITY = [
  "final invoice",
  "scan reports",
  "calibration records",
  "alignment printout",
  "teardown/in-process photos",
  "OEM procedure excerpts",
] as const;

export function buildNextBatchPrompt(
  totalFilesReviewed: number,
  maxBatchFiles = STARTER_UPLOAD_BATCH_FILE_LIMIT
) {
  return `Files reviewed so far: ${totalFilesReviewed}. You can upload another batch when ready. Upload the next ${maxBatchFiles} most important files: ${NEXT_UPLOAD_PRIORITY.join(", ")}.`;
}

export function buildUploadBatchGuidance(
  totalFilesReviewed: number,
  currentBatchCount: number,
  maxBatchFiles = STARTER_UPLOAD_BATCH_FILE_LIMIT,
  plan?: "free" | "starter" | "trial" | "pro" | "admin"
) {
  const uploadLimitText =
    plan === "free"
      ? "Free accounts can upload 1 file per analysis."
      : maxBatchFiles === 1
      ? "You can upload 1 file per review."
      : `You can upload up to ${maxBatchFiles} files at a time.`;

  return [
    plan === "free"
      ? "Free accounts can upload PDFs or photos."
      : "You can upload PDFs, photos, screenshots, or ZIP files.",
    uploadLimitText,
    plan === "free" ? "Free accounts include 5 uploads per rolling month." : null,
    `Files reviewed so far: ${totalFilesReviewed}.`,
    currentBatchCount >= maxBatchFiles - 1
      ? `Upload the next ${maxBatchFiles} most important files.`
      : "After this batch is processed, you can add another batch.",
    `Next best files: ${NEXT_UPLOAD_PRIORITY.join(", ")}.`,
  ].filter(Boolean).join(" ");
}
