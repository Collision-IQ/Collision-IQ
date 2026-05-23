import type { PolicyLegalContext, PolicyLegalReview } from "@/lib/ai/types/analysis";

export const POLICY_LEGAL_METRICS = [
  "policy_legal_review_generated",
  "policy_legal_snapshot_created",
  "policy_legal_regulation_access",
  "policy_legal_placeholder_used",
  "policy_legal_verified_regulation_used",
  "policy_legal_missing_citation",
  "policy_legal_regulation_db_fallback",
  "policy_legal_snapshot_create_failed",
] as const;

export type PolicyLegalMetricName = (typeof POLICY_LEGAL_METRICS)[number];

const metricCounters = new Map<PolicyLegalMetricName, number>();

export function incrementPolicyLegalMetric(
  name: PolicyLegalMetricName,
  value = 1,
  dimensions: Record<string, string | number | boolean | null> = {}
) {
  metricCounters.set(name, (metricCounters.get(name) ?? 0) + value);
  console.info("[policy-legal:metric]", {
    metric: name,
    value,
    dimensions: sanitizeObservabilityPayload(dimensions),
  });
}

export function getPolicyLegalMetricCount(name: PolicyLegalMetricName) {
  return metricCounters.get(name) ?? 0;
}

export function resetPolicyLegalMetricsForTests() {
  metricCounters.clear();
}

export function logPolicyLegalEvent(
  event: string,
  payload: Record<string, unknown> = {},
  level: "info" | "warn" | "error" = "info"
) {
  const safePayload = sanitizeObservabilityPayload(payload);
  const logPayload = {
    event,
    ...safePayload,
  };

  if (level === "warn") {
    console.warn("[policy-legal]", logPayload);
    return;
  }

  if (level === "error") {
    console.error("[policy-legal]", logPayload);
    return;
  }

  console.info("[policy-legal]", logPayload);
}

export function observePolicyLegalStateDetection(params: {
  inputStateProvided: boolean;
  zipProvided: boolean;
  textZipDetected: boolean;
  claimState: string | null;
}) {
  logPolicyLegalEvent("state_detection_result", {
    inputStateProvided: params.inputStateProvided,
    zipProvided: params.zipProvided,
    textZipDetected: params.textZipDetected,
    claimState: params.claimState,
    stateDetected: Boolean(params.claimState),
  });
}

export function observePolicyLegalContextInjection(context: PolicyLegalContext) {
  const verifiedCount = context.applicable_regulations.filter(
    (regulation) => regulation.verification_state === "verified"
  ).length;
  const placeholderCount = context.applicable_regulations.filter(
    (regulation) => regulation.verification_state === "placeholder"
  ).length;

  logPolicyLegalEvent("context_injected", {
    claimState: context.claim_state,
    verifiedRegulationCount: verifiedCount,
    placeholderRegulationCount: placeholderCount,
    citationRequired: context.citation_required,
  });
}

export function observePolicyLegalReviewGenerated(review: PolicyLegalReview) {
  incrementPolicyLegalMetric("policy_legal_review_generated", 1, {
    claimState: review.claim_context.claim_state,
  });

  const placeholderCount = review.regulatory_support_log.filter(
    (entry) => entry.support === "placeholder"
  ).length;
  if (placeholderCount > 0) {
    incrementPolicyLegalMetric("policy_legal_placeholder_used", placeholderCount, {
      claimState: review.claim_context.claim_state,
    });
  }

  const verifiedRegulationCount = review.line_item_reviews.filter(
    (entry) => entry.source_type === "Regulation"
  ).length;
  if (verifiedRegulationCount > 0) {
    incrementPolicyLegalMetric("policy_legal_verified_regulation_used", verifiedRegulationCount, {
      claimState: review.claim_context.claim_state,
    });
  }

  const missingCitationCount = review.citation_log.filter(
    (entry) => !entry.complete || !entry.citation?.trim()
  ).length;
  if (missingCitationCount > 0) {
    incrementPolicyLegalMetric("policy_legal_missing_citation", missingCitationCount, {
      claimState: review.claim_context.claim_state,
    });
    logPolicyLegalEvent(
      "citation_enforcement_failure",
      {
        claimState: review.claim_context.claim_state,
        missingCitationCount,
      },
      "warn"
    );
  }
}

export function observePolicyLegalRegulationAccess(params: {
  state: string | null;
  status: number;
  totalCount: number;
  verifiedCount: number;
  placeholderCount: number;
  cacheStatus: string | null;
}) {
  incrementPolicyLegalMetric("policy_legal_regulation_access", 1, {
    state: params.state,
    status: params.status,
    cacheStatus: params.cacheStatus,
  });
  logPolicyLegalEvent("regulation_access", params);
}

export function observePolicyLegalRegulationDbFallback(params: {
  state: string | null;
  errorName?: string;
}) {
  incrementPolicyLegalMetric("policy_legal_regulation_db_fallback", 1, {
    state: params.state,
  });
  logPolicyLegalEvent("regulation_db_fallback", params, "warn");
}

export function observePolicyLegalSnapshotCreated(params: {
  claimState: string | null;
  PolicyLegalConfidenceScore: number;
  regulationCount: number;
  citationCount: number;
  placeholderCitationCount: number;
}) {
  incrementPolicyLegalMetric("policy_legal_snapshot_created", 1, {
    claimState: params.claimState,
  });
  logPolicyLegalEvent("snapshot_creation_success", params);
}

export function observePolicyLegalSnapshotFailure(params: {
  claimState: string | null;
  errorName?: string;
}) {
  incrementPolicyLegalMetric("policy_legal_snapshot_create_failed", 1, {
    claimState: params.claimState,
  });
  logPolicyLegalEvent("snapshot_creation_failure", params, "error");
}

function sanitizeObservabilityPayload(payload: Record<string, unknown>) {
  const safe: Record<string, unknown> = {};
  const allowedKeys = new Set([
    "cacheStatus",
    "citationCount",
    "citationRequired",
    "claimState",
    "errorName",
    "inputStateProvided",
    "lineItemCount",
    "metric",
    "missingCitationCount",
    "placeholderCitationCount",
    "placeholderCount",
    "placeholderRegulationCount",
    "PolicyLegalConfidenceScore",
    "regulationCount",
    "state",
    "stateDetected",
    "status",
    "textZipDetected",
    "totalCount",
    "value",
    "verifiedCount",
    "verifiedRegulationCount",
    "zipProvided",
  ]);

  for (const [key, value] of Object.entries(payload)) {
    if (!allowedKeys.has(key)) {
      continue;
    }
    safe[key] = value;
  }

  return safe;
}
