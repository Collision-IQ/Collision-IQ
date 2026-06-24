export type AnalysisLifecycleStage =
  | "upload_received"
  | "upload_complete"
  | "files_indexed"
  | "preliminary_review_started"
  | "preliminary_review_complete"
  | "full_analysis_started"
  | "estimate_pair_resolved"
  | "structured_deltas_started"
  | "structured_deltas_complete"
  | "repair_intelligence_started"
  | "repair_intelligence_complete"
  | "snapshot_started"
  | "snapshot_complete"
  | "report_exports_started"
  | "report_exports_complete"
  | "right_rail_state_published"
  | "full_analysis_complete"
  | "full_analysis_failed"
  | "full_analysis_timeout";

export const ANALYSIS_STILL_RUNNING_MESSAGE =
  "Analysis is still running. Reports will appear when ready. You can keep using chat.";

export const ANALYSIS_TIMEOUT_MESSAGE =
  "Analysis timed out while preparing reports. Retry report generation.";

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
}) {
  const uploaded = Math.max(
    input.current.uploaded + normalizeCount(input.attachmentCount),
    normalizeCount(input.uploaded),
    input.current.uploaded
  );
  const indexed = Math.max(
    input.current.indexed + normalizeCount(input.indexed),
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
  } = {}
) {
  const timeoutMs = options.timeoutMs ?? ANALYSIS_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error(options.timeoutMessage ?? ANALYSIS_TIMEOUT_MESSAGE)), timeoutMs);

  const onAbort = () => controller.abort(options.parentSignal?.reason);
  if (options.parentSignal) {
    if (options.parentSignal.aborted) {
      controller.abort(options.parentSignal.reason);
    } else {
      options.parentSignal.addEventListener("abort", onAbort, { once: true });
    }
  }

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted && !options.parentSignal?.aborted) {
      throw new Error(options.timeoutMessage ?? ANALYSIS_TIMEOUT_MESSAGE);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    options.parentSignal?.removeEventListener("abort", onAbort);
  }
}

function normalizeCount(value: number | undefined) {
  return Number.isFinite(value) && typeof value === "number" ? Math.max(0, value) : 0;
}

function defaultAnalysisLifecycleEmit(event: AnalysisLifecycleEvent) {
  console.info("[analysis-lifecycle]", event);
}
