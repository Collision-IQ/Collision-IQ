export const ZIP_UPLOAD_PROGRESS_MESSAGE =
  "I'm receiving and extracting the ZIP now. I'll start review as soon as files are available.";

export const ZIP_EXTRACTED_REVIEW_START_MESSAGE_PREFIX =
  "ZIP extracted. I found";

export type UploadBlockingPhase =
  | "requesting-direct-upload"
  | "uploading"
  | "finalizing"
  | "extracting"
  | "indexing";

export type UploadLifecyclePhase =
  | UploadBlockingPhase
  | "complete"
  | "failed"
  | "canceled";

export type UploadLifecycleItem = {
  id: string;
  name?: string | null;
  mimeType?: string | null;
  phase: UploadLifecyclePhase;
  directUpload?: boolean;
};

export type QueuedReviewPrompt = {
  id: number;
  prompt: string;
  status: "queued" | "flushing";
};

const ZIP_MIME_TYPES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "multipart/x-zip",
]);

const ZIP_BLOCKING_PHASES = new Set<UploadLifecyclePhase>([
  "requesting-direct-upload",
  "uploading",
  "finalizing",
  "extracting",
  "indexing",
]);

export function isZipLifecycleItem(item: Pick<UploadLifecycleItem, "name" | "mimeType">) {
  const name = item.name?.toLowerCase() ?? "";
  const mimeType = item.mimeType?.toLowerCase() ?? "";
  return name.endsWith(".zip") || ZIP_MIME_TYPES.has(mimeType);
}

export function isUploadBlockingAnalysis(items: UploadLifecycleItem[]) {
  return items.some((item) => {
    const isDirectUpload = item.directUpload === true;
    return (isZipLifecycleItem(item) || isDirectUpload) && ZIP_BLOCKING_PHASES.has(item.phase);
  });
}

export function hasFailedBlockingUpload(items: UploadLifecycleItem[]) {
  return items.some((item) => (isZipLifecycleItem(item) || item.directUpload === true) && item.phase === "failed");
}

export function shouldFlushQueuedReviewPrompt(params: {
  queuedPrompt: QueuedReviewPrompt | null;
  lifecycleItems: UploadLifecycleItem[];
  reviewableFileCount: number;
}) {
  return Boolean(
    params.queuedPrompt &&
      params.queuedPrompt.status === "queued" &&
      !isUploadBlockingAnalysis(params.lifecycleItems) &&
      !hasFailedBlockingUpload(params.lifecycleItems) &&
      params.reviewableFileCount > 0
  );
}

export function buildZipExtractedReviewStartMessage(params: {
  totalFiles: number;
  pdfCount: number;
  imageCount: number;
}) {
  return `${ZIP_EXTRACTED_REVIEW_START_MESSAGE_PREFIX} ${params.totalFiles} files: ${params.pdfCount} PDFs, ${params.imageCount} images. Starting preliminary triage.`;
}
