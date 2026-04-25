export const NEXT_UPLOAD_PRIORITY = [
  "final invoice",
  "scan reports",
  "calibration records",
  "alignment printout",
  "teardown/in-process photos",
  "OEM procedure excerpts",
] as const;

export function buildNextBatchPrompt(totalFilesReviewed: number, maxBatchFiles = 6) {
  return `Files reviewed so far: ${totalFilesReviewed}. You can upload another batch when ready. Upload the next ${maxBatchFiles} most important files: ${NEXT_UPLOAD_PRIORITY.join(", ")}.`;
}

export function buildUploadBatchGuidance(
  totalFilesReviewed: number,
  currentBatchCount: number,
  maxBatchFiles = 6
) {
  return [
    `You can upload up to ${maxBatchFiles} files at a time.`,
    `Files reviewed so far: ${totalFilesReviewed}.`,
    currentBatchCount >= maxBatchFiles - 1
      ? `Upload the next ${maxBatchFiles} most important files.`
      : "After this batch is processed, you can add another batch.",
    `Next best files: ${NEXT_UPLOAD_PRIORITY.join(", ")}.`,
  ].join(" ");
}
