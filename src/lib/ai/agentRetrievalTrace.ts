export type AgentRetrievalStepStatus = "success" | "skipped" | "error";

export type AgentRetrievalTool =
  | "estimate_link_reader"
  | "google_drive_search"
  | "web_search";

export type AgentRetrievalStep = {
  order: 1 | 2 | 3;
  tool: AgentRetrievalTool;
  action: string;
  resultCount: number;
  status: AgentRetrievalStepStatus;
  reason?: string;
};

export type AgentRetrievalTrace = {
  runId: string;
  flow: "chat" | "analysis";
  caseId?: string | null;
  userId?: string | null;
  startedAt: string;
  steps: AgentRetrievalStep[];
};

const SENSITIVE_REASON_PATTERNS = [
  /quota/i,
  /billing/i,
  /rate limit/i,
  /insufficient_quota/i,
  /api[_ -]?key/i,
  /authorization/i,
  /bearer/i,
  /token/i,
  /secret/i,
  /password/i,
  /openai/i,
  /serper/i,
];

export function createAgentRetrievalTrace(params: {
  flow: AgentRetrievalTrace["flow"];
  caseId?: string | null;
  userId?: string | null;
  runId?: string;
  startedAt?: string;
}): AgentRetrievalTrace {
  const trace = {
    runId: params.runId ?? createRunId(),
    flow: params.flow,
    caseId: params.caseId ?? null,
    userId: params.userId ?? null,
    startedAt: params.startedAt ?? new Date().toISOString(),
    steps: [],
  };

  logAgentTraceEvent("run started", trace);
  return trace;
}

export function recordAgentRetrievalStep(
  trace: AgentRetrievalTrace,
  step: AgentRetrievalStep
): AgentRetrievalTrace {
  const safeStep = {
    ...step,
    resultCount: Math.max(0, Math.trunc(step.resultCount || 0)),
    reason: sanitizeTraceReason(step.reason),
  };
  const existingIndex = trace.steps.findIndex((item) => item.order === safeStep.order);
  const nextSteps =
    existingIndex >= 0
      ? trace.steps.map((item, index) => (index === existingIndex ? safeStep : item))
      : [...trace.steps, safeStep];

  trace.steps = nextSteps.sort((left, right) => left.order - right.order);
  return trace;
}

export function areInternalRetrievalPathsResolved(trace: AgentRetrievalTrace): boolean {
  return [1, 2].every((order) =>
    trace.steps.some((step) => step.order === order && isTerminalStatus(step.status))
  );
}

export function sanitizeTraceReason(reason: unknown): string | undefined {
  if (typeof reason !== "string") return undefined;
  const trimmed = reason.trim();
  if (!trimmed) return undefined;

  if (SENSITIVE_REASON_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return "Provider/internal detail suppressed.";
  }

  return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed;
}

export function logAgentTraceEvent(
  event: string,
  trace: AgentRetrievalTrace,
  details?: Record<string, unknown>
) {
  console.info(`[agent-trace] ${event}`, {
    runId: trace.runId,
    flow: trace.flow,
    caseId: trace.caseId ?? null,
    userId: trace.userId ?? null,
    stepCount: trace.steps.length,
    ...(details ?? {}),
  });
}

export function logAgentTraceCompleted(trace: AgentRetrievalTrace) {
  console.info("[agent-trace] run completed", {
    runId: trace.runId,
    flow: trace.flow,
    caseId: trace.caseId ?? null,
    userId: trace.userId ?? null,
    startedAt: trace.startedAt,
    completedAt: new Date().toISOString(),
    steps: trace.steps,
  });
}

function isTerminalStatus(status: AgentRetrievalStepStatus) {
  return status === "success" || status === "skipped" || status === "error";
}

function createRunId() {
  const cryptoSource = globalThis.crypto as Crypto | undefined;
  if (cryptoSource?.randomUUID) {
    return cryptoSource.randomUUID();
  }

  return `agent-trace-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
