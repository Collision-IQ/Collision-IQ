export type AnalysisLifecycleStage =
  | "upload_received"
  | "upload_complete"
  | "files_indexed"
  | "analysis_job_started"
  | "unique_documents_resolved"
  | "duplicate_documents_skipped"
  | "preliminary_review_started"
  | "preliminary_review_complete"
  | "structured_estimate_parse_started"
  | "structured_estimate_parse_complete"
  | "structured_deltas_ready"
  | "full_analysis_started"
  | "estimate_pair_resolved"
  | "repair_intelligence_started"
  | "repair_intelligence_complete"
  | "snapshot_started"
  | "snapshot_complete"
  | "report_exports_started"
  | "report_exports_complete"
  | "right_rail_state_published"
  | "full_analysis_complete"
  | "full_analysis_failed"
  | "full_analysis_timeout"
  | "retry_started"
  | "retry_failed"
  | "retry_complete"
  | "retry_delta_report_clicked"
  | "delta_auto_generation_queued"
  | "delta_auto_generation_started"
  | "delta_generate_button_clicked"
  | "delta_generate_button_ignored_already_running"
  | "delta_report_generation_started"
  | "delta_report_generation_complete"
  | "delta_report_generation_failed";

export const ANALYSIS_STILL_RUNNING_MESSAGE =
  "Analysis is still running. Reports will appear when ready. You can keep using chat.";

export const ANALYSIS_TIMEOUT_MESSAGE =
  "Full analysis timed out, but structured estimate comparison may be available. You can retry full analysis or generate Delta Citation Density.";

export const ANALYSIS_STALE_AFTER_MS = 90_000;
export const ANALYSIS_FETCH_TIMEOUT_MS = 90_000;
export const ANALYSIS_STILL_RUNNING_AFTER_MS = 18_000;

export type AnalysisLifecycleContext = {
  requestId: string;
  caseId?: string | null;
  fileCount?: number;
};

export type AnalysisLifecycleEvent = AnalysisLifecycleContext & {
  stage: AnalysisLifecycleStage;
  durationMs: number;
  status?: string;
  detail?: string | null;
};

export type ReviewableDocumentInput = {
  documentId?: string | null;
  uploadId?: string | null;
  attachmentId?: string | null;
  id?: string | null;
  sha256?: string | null;
  fileHash?: string | null;
  filename?: string | null;
  name?: string | null;
  sizeBytes?: number | null;
  size?: number | null;
  uploadBatchId?: string | null;
};

export function createAnalysisRequestId(prefix = "analysis") {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function createAnalysisLifecycleLogger(
  context: AnalysisLifecycleContext,
  emit: (event: AnalysisLifecycleEvent) => void = defaultAnalysisLifecycleEmit
) {
  const startedAt = Date.now();
  const stageStarts = new Map<AnalysisLifecycleStage, number>();

  return {
    stage(stage: AnalysisLifecycleStage, extra: Partial<AnalysisLifecycleEvent> = {}) {
      const now = Date.now();
      const durationMs = stageStarts.has(stage)
        ? now - (stageStarts.get(stage) ?? now)
        : now - startedAt;
      stageStarts.set(stage, now);
      emit({
        ...context,
        ...extra,
        stage,
        durationMs,
      });
    },
  };
}

export function resolveHydrationReviewProgress(input: {
  current: {
    uploaded: number;
    indexed: number;
    reviewedForDetermination: number;
    reviewableFileCount: number;
    totalKnownFiles: number;
  };
  uploaded?: number;
  indexed?: number;
  attachmentCount?: number;
  uniqueDocumentCount?: number;
}) {
  const uniqueCount = normalizeCount(input.uniqueDocumentCount);
  const uploaded = Math.max(
    uniqueCount,
    normalizeCount(input.uploaded),
    input.current.uploaded
  );
  const indexed = Math.max(
    uniqueCount,
    normalizeCount(input.indexed),
    normalizeCount(input.attachmentCount),
    input.current.indexed
  );
  const reviewableFileCount = Math.max(
    input.current.reviewableFileCount,
    indexed,
    uploaded,
    input.current.reviewedForDetermination
  );

  return {
    uploaded,
    indexed,
    reviewableFileCount,
    totalKnownFiles: Math.max(input.current.totalKnownFiles, uploaded, indexed, reviewableFileCount),
  };
}

export function getUniqueReviewableDocuments<T extends ReviewableDocumentInput>(documents: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];

  documents.forEach((document, index) => {
    const key = getReviewableDocumentKey(document, index);
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(document);
  });

  return unique;
}

export function getReviewableDocumentKey(document: ReviewableDocumentInput, index = 0) {
  const id = firstNonEmpty([
    document.documentId,
    document.uploadId,
    document.attachmentId,
    document.id,
  ]);
  if (id) return `id:${id}`;

  const hash = firstNonEmpty([document.sha256, document.fileHash]);
  if (hash) return `hash:${hash}`;

  const filename = normalizeFilename(document.filename ?? document.name);
  const size = typeof document.sizeBytes === "number"
    ? document.sizeBytes
    : typeof document.size === "number"
      ? document.size
      : null;
  const batch = firstNonEmpty([document.uploadBatchId]) ?? "batchless";
  if (filename && size !== null) return `file:${filename}:${size}:${batch}`;
  if (filename) return `file:${filename}:${batch}`;
  return `unknown:${index}`;
}

export function isStaleProcessing(input: {
  status: "idle" | "processing" | "complete" | "error";
  loading: boolean;
  startedAt: number | null;
  now?: number;
  staleAfterMs?: number;
}) {
  if (input.status !== "processing" && !input.loading) return false;
  if (!input.startedAt) return false;
  const ageMs = (input.now ?? Date.now()) - input.startedAt;
  return ageMs >= (input.staleAfterMs ?? ANALYSIS_STALE_AFTER_MS);
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: {
    timeoutMs?: number;
    timeoutMessage?: string;
    parentSignal?: AbortSignal | null;
    abortOnTimeout?: boolean;
  } = {}
) {
  const timeoutMs = options.timeoutMs ?? ANALYSIS_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const onAbort = () => controller.abort(options.parentSignal?.reason);
  if (options.parentSignal) {
    if (options.parentSignal.aborted) {
      controller.abort(options.parentSignal.reason);
    } else {
      options.parentSignal.addEventListener("abort", onAbort, { once: true });
    }
  }

  const fetchPromise = fetch(input, {
      ...init,
      signal: controller.signal,
    });
  fetchPromise.catch(() => undefined);

  const timeoutPromise = new Promise<Response>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      if (options.abortOnTimeout !== false) {
        controller.abort(new Error(options.timeoutMessage ?? ANALYSIS_TIMEOUT_MESSAGE));
      }
      reject(new Error(options.timeoutMessage ?? ANALYSIS_TIMEOUT_MESSAGE));
    }, timeoutMs);
  });

  try {
    return await Promise.race([fetchPromise, timeoutPromise]);
  } catch (error) {
    if ((timedOut || controller.signal.aborted) && !options.parentSignal?.aborted) {
      throw new Error(options.timeoutMessage ?? ANALYSIS_TIMEOUT_MESSAGE);
    }
    throw error;
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
    options.parentSignal?.removeEventListener("abort", onAbort);
  }
}

function normalizeCount(value: number | undefined) {
  return Number.isFinite(value) && typeof value === "number" ? Math.max(0, value) : 0;
}

function firstNonEmpty(values: Array<string | null | undefined>) {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? null;
}

function normalizeFilename(value: string | null | undefined) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";
}

function defaultAnalysisLifecycleEmit(event: AnalysisLifecycleEvent) {
  console.info("[analysis-lifecycle]", event);
}
