/**
 * Collision Learning Engine — pure promotion-gate rules (no server imports so
 * they are directly unit-testable). promotionGate.ts applies these against
 * the database.
 */

export type PromotionAttempt = {
  mode: string;
  grade: number;
  citationFidelity: number;
  errorCodes: string[];
  createdAt: Date;
};

export type PromotionCandidate = {
  status: string;
  safetyCritical: boolean;
  sourceFingerprint: string;
};

export type PromotionBenchmark = {
  id: string;
  completedAt: Date | null;
  /** True when any tracked metric regressed vs the prior comparable run. */
  hasRegression: boolean;
};

export type PromotionEligibility = {
  eligible: boolean;
  failedGates: string[];
};

const DELAYED_RECALL_MIN_GAP_MS = 7 * 24 * 60 * 60 * 1000;
const CITATION_FIDELITY_MINIMUM = 0.98;

/**
 * Gates, per the blueprint:
 *  1. Verified source (item status VERIFIED — never DRAFT/INVALIDATED).
 *  2. Passing delayed recall (grade ≥ 4 at least 7 days after the first pass).
 *  3. Passing contrast test (CONTRAST attempt with grade ≥ 4).
 *  4. Passing novel-case transfer (INTERLEAVED_CASE or FULL_REPORT grade ≥ 4).
 *  5. Passing citation review (latest passing attempt ≥ 98% citation fidelity).
 *  6. No safety-critical miss anywhere in the attempt history.
 *  7. No relevant benchmark regression, and the run must be completed.
 */
export function evaluatePromotionEligibility(params: {
  item: PromotionCandidate;
  attempts: PromotionAttempt[];
  benchmark: PromotionBenchmark | null;
}): PromotionEligibility {
  const failedGates: string[] = [];
  const { item, attempts, benchmark } = params;

  if (item.status !== "VERIFIED") {
    failedGates.push(`item status must be VERIFIED (currently ${item.status})`);
  }

  const passing = attempts.filter((attempt) => attempt.grade >= 4);
  const firstPass = passing.reduce<Date | null>(
    (earliest, attempt) => (!earliest || attempt.createdAt < earliest ? attempt.createdAt : earliest),
    null
  );
  const delayedPass = passing.some(
    (attempt) => firstPass && attempt.createdAt.getTime() - firstPass.getTime() >= DELAYED_RECALL_MIN_GAP_MS
  );
  if (!delayedPass) failedGates.push("no passing delayed recall (grade ≥ 4 at least 7 days after the first pass)");

  if (!passing.some((attempt) => attempt.mode === "CONTRAST")) {
    failedGates.push("no passing contrast test");
  }
  if (!passing.some((attempt) => attempt.mode === "INTERLEAVED_CASE" || attempt.mode === "FULL_REPORT")) {
    failedGates.push("no passing novel-case transfer test");
  }

  const latestPassing = [...passing].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (!latestPassing || latestPassing.citationFidelity < CITATION_FIDELITY_MINIMUM) {
    failedGates.push(`citation fidelity below ${CITATION_FIDELITY_MINIMUM * 100}% on the latest passing attempt`);
  }

  if (attempts.some((attempt) => attempt.errorCodes.includes("SAFETY_CRITICAL_MISS"))) {
    failedGates.push("safety-critical miss present in attempt history");
  }

  if (!benchmark) {
    failedGates.push("no completed benchmark run referenced");
  } else if (!benchmark.completedAt) {
    failedGates.push("referenced benchmark run has not completed");
  } else if (benchmark.hasRegression) {
    failedGates.push("referenced benchmark run shows a regression");
  }

  return { eligible: failedGates.length === 0, failedGates };
}
