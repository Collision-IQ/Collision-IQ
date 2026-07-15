/**
 * Collision Learning Engine — answer evaluator.
 *
 * The evaluator is the ONLY component that sees the gold answer and source
 * refs, and it runs strictly AFTER the candidate response is complete. It is
 * deterministic (rubric-v1) so results are repeatable and testable offline;
 * a model-graded second pass can be layered later without changing callers.
 *
 * Evaluator output must never flow back into the response-generating prompt.
 */

import type { LearningSourceRef } from "./sourceAuthority";

export const EVALUATOR_VERSION = "rubric-v1";

export type GoldKeyPoint = {
  text: string;
  /** Alternate phrasings that count as a hit. */
  aliases?: string[];
  required?: boolean;
  safetyCritical?: boolean;
};

export type GoldAnswer = {
  keyPoints: GoldKeyPoint[];
  /** Phrases that, if asserted, are unsupported/forbidden claims. */
  forbiddenAssertions?: string[];
  /** When true, the correct answer must state the vehicle is unsupported. */
  unsupportedVehicle?: boolean;
  /** When true, the answer must acknowledge uncertainty / missing info. */
  requiresUncertainty?: boolean;
  /** Substrings the answer should cite/name as its authority class. */
  expectedAuthorityMentions?: string[];
};

export type LearningEvaluation = {
  grade: number;
  factualAccuracy: number;
  evidenceCoverage: number;
  citationFidelity: number;
  safetyRecall: number;
  calibrationScore: number;
  unsupportedClaimRate: number;
  evaluatorVersion: string;
  errorCodes: string[];
  notes: string[];
};

export type EvaluateParams = {
  candidateText: string;
  goldAnswer: GoldAnswer;
  sourceRefs: LearningSourceRef[];
  safetyCritical: boolean;
  vehicleScope?: unknown;
  jurisdiction?: string | null;
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 %&./-]+/g, " ").replace(/\s+/g, " ").trim();
}

function containsPhrase(haystack: string, phrase: string): boolean {
  const needle = normalize(phrase);
  if (!needle) return false;
  return haystack.includes(needle);
}

function keyPointHit(haystack: string, keyPoint: GoldKeyPoint): boolean {
  if (containsPhrase(haystack, keyPoint.text)) return true;
  return (keyPoint.aliases ?? []).some((alias) => containsPhrase(haystack, alias));
}

const UNSUPPORTED_ACKNOWLEDGEMENT = /\b(?:unsupported|not (?:a )?supported|no (?:motor|coverage|data) (?:coverage|available)|outside (?:the )?(?:authorized|licensed) (?:vehicle )?scope)\b/i;
const UNCERTAINTY_MARKERS = /\b(?:not enough information|cannot determine|requires verification|needs verification|unknown|would need|must be confirmed|unable to confirm|missing information|still missing)\b/i;
const OVERCLAIM_MARKERS = /\b(?:always required on every vehicle|all (?:vehicles|manufacturers) require|guaranteed|definitely required for every|comprehensive motor coverage|full motor database)\b/i;

export function evaluateLearningAnswer(params: EvaluateParams): LearningEvaluation {
  const haystack = normalize(params.candidateText);
  const errorCodes: string[] = [];
  const notes: string[] = [];
  const gold = params.goldAnswer;
  const keyPoints = gold.keyPoints ?? [];

  // ── Unsupported-vehicle handling is absolute ───────────────────────────────
  if (gold.unsupportedVehicle) {
    const acknowledged = UNSUPPORTED_ACKNOWLEDGEMENT.test(params.candidateText);
    if (!acknowledged) {
      errorCodes.push("UNSUPPORTED_VEHICLE_NOT_DECLARED");
      return {
        grade: 0,
        factualAccuracy: 0,
        evidenceCoverage: 0,
        citationFidelity: 0,
        safetyRecall: 0,
        calibrationScore: 0,
        unsupportedClaimRate: 1,
        evaluatorVersion: EVALUATOR_VERSION,
        errorCodes,
        notes: ["Vehicle is outside supported scope and the answer did not say so."],
      };
    }
  }

  // ── Key-point coverage ─────────────────────────────────────────────────────
  const hits = keyPoints.filter((keyPoint) => keyPointHit(haystack, keyPoint));
  const factualAccuracy = keyPoints.length === 0 ? 1 : hits.length / keyPoints.length;

  const requiredPoints = keyPoints.filter((keyPoint) => keyPoint.required !== false);
  const requiredHits = requiredPoints.filter((keyPoint) => keyPointHit(haystack, keyPoint));
  const evidenceCoverage = requiredPoints.length === 0 ? 1 : requiredHits.length / requiredPoints.length;
  for (const missed of requiredPoints.filter((keyPoint) => !keyPointHit(haystack, keyPoint))) {
    errorCodes.push("MISSED_REQUIRED_POINT");
    notes.push(`Missed required point: ${missed.text.slice(0, 80)}`);
  }

  // ── Safety recall ──────────────────────────────────────────────────────────
  const safetyPoints = keyPoints.filter((keyPoint) => keyPoint.safetyCritical);
  const safetyHits = safetyPoints.filter((keyPoint) => keyPointHit(haystack, keyPoint));
  const safetyRecall = safetyPoints.length === 0 ? 1 : safetyHits.length / safetyPoints.length;
  if (safetyPoints.length > 0 && safetyHits.length < safetyPoints.length) {
    errorCodes.push("SAFETY_CRITICAL_MISS");
  }

  // ── Unsupported / forbidden claims ─────────────────────────────────────────
  const forbidden = gold.forbiddenAssertions ?? [];
  const forbiddenHits = forbidden.filter((assertion) => containsPhrase(haystack, assertion));
  let unsupportedClaimRate = forbidden.length === 0 ? 0 : forbiddenHits.length / forbidden.length;
  if (forbiddenHits.length > 0) {
    errorCodes.push("UNSUPPORTED_ASSERTION");
    notes.push(...forbiddenHits.map((assertion) => `Asserted forbidden claim: ${assertion.slice(0, 80)}`));
  }
  if (OVERCLAIM_MARKERS.test(params.candidateText)) {
    errorCodes.push("SCOPE_OVERCLAIM");
    unsupportedClaimRate = Math.max(unsupportedClaimRate, 0.5);
  }

  // ── Citation fidelity (authority-class mentions, not fabricated cites) ────
  const expectedAuthority = gold.expectedAuthorityMentions ?? [];
  const authorityHits = expectedAuthority.filter((mention) => containsPhrase(haystack, mention));
  const citationFidelity = expectedAuthority.length === 0 ? 1 : authorityHits.length / expectedAuthority.length;
  if (expectedAuthority.length > 0 && authorityHits.length === 0) {
    errorCodes.push("WRONG_AUTHORITY_CLASS");
  }

  // ── Calibration ────────────────────────────────────────────────────────────
  let calibrationScore = 1;
  if (gold.requiresUncertainty && !UNCERTAINTY_MARKERS.test(params.candidateText)) {
    calibrationScore = 0;
    errorCodes.push("MISSING_UNCERTAINTY");
  }

  // ── Grade ──────────────────────────────────────────────────────────────────
  let grade: number;
  const safetyMiss = errorCodes.includes("SAFETY_CRITICAL_MISS");
  if ((params.safetyCritical && safetyMiss) || forbiddenHits.length > 0) {
    grade = 0;
  } else if (evidenceCoverage < 0.5) {
    grade = 1;
  } else if (evidenceCoverage < 1 || calibrationScore < 1) {
    grade = 2;
  } else if (citationFidelity < 1) {
    grade = 3;
  } else if (factualAccuracy < 1) {
    grade = 4;
  } else {
    grade = 5;
  }

  return {
    grade,
    factualAccuracy,
    evidenceCoverage,
    citationFidelity,
    safetyRecall,
    calibrationScore,
    unsupportedClaimRate,
    evaluatorVersion: EVALUATOR_VERSION,
    errorCodes: [...new Set(errorCodes)],
    notes,
  };
}
