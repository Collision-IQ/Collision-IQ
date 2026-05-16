import {
  getReviewCompletenessState,
  type ReviewCompletenessState,
} from "../reviewCompleteness";
import { sanitizeUserFacingEvidenceText } from "../ui/presentationText";

export type AppraisalAwardPosture =
  | "SHOP_SUPPORTED"
  | "CARRIER_SUPPORTED"
  | "RECONCILED_SUPPORTED"
  | "DEFER_FOR_MATERIAL_EVIDENCE";

export type AppraisalAwardBasis = {
  posture: AppraisalAwardPosture;
  confidence: "low" | "moderate" | "high";
  reason: string;
  safetyCriticalSupport: string[];
  carrierVulnerabilities: string[];
  shopVulnerabilities: string[];
  recommendedLanguage: string;
};

export type AppraisalAwardEvaluatorInput = {
  shopEstimateSummary?: string | null;
  carrierEstimateSummary?: string | null;
  repairOperations?: string[];
  fileEvidenceSupportSignals?: string[];
  oemProcedureSupportSignals?: string[];
  invoiceScanCalibrationAlignmentIndicators?: string[];
  completionIndicators?: string[];
  carrierVulnerabilitySignals?: string[];
  shopVulnerabilitySignals?: string[];
  unresolvedMaterialEvidence?: string[];
  reviewedFileCount?: number | null;
  totalKnownFileCount?: number | null;
};

const SAFETY_CRITICAL_PATTERN =
  /\b(oem|procedure|scan|calibration|alignment|adas|structural|measure|geometry|test[- ]?fit|road[- ]?test|weld|bond|corrosion|cooling|airbag|srs|seatbelt|restraint|sensor|radar|camera|frame|unibody|safety)\b/i;

const MATERIAL_FINALITY_PATTERN =
  /\b(final invoice|invoice|final supplement|supplement|estimate|calibration|alignment|scan|oem procedure|structural measurement|test[- ]?fit|road[- ]?test|appraisal document|policy|completion)\b/i;

export function evaluateAppraisalAward(
  input: AppraisalAwardEvaluatorInput
): AppraisalAwardBasis {
  const safetyCriticalSupport = cleanList([
    ...(input.oemProcedureSupportSignals ?? []),
    ...(input.invoiceScanCalibrationAlignmentIndicators ?? []),
    ...(input.completionIndicators ?? []),
    ...(input.repairOperations ?? []).filter((item) => SAFETY_CRITICAL_PATTERN.test(item)),
    ...(input.fileEvidenceSupportSignals ?? []).filter((item) => SAFETY_CRITICAL_PATTERN.test(item)),
  ]).slice(0, 8);

  const carrierVulnerabilities = cleanList([
    ...(input.carrierVulnerabilitySignals ?? []),
    ...(input.repairOperations ?? []).filter((item) => /\bmissing|underwritten|omitted|short|not included|deduct|deny|reduc/i.test(item)),
  ]).slice(0, 8);

  const shopVulnerabilities = cleanList([
    ...(input.shopVulnerabilitySignals ?? []),
    ...(input.unresolvedMaterialEvidence ?? []).filter((item) =>
      /\bunsupported|not established|not yet located|final proof incomplete|not final-award confidence|unresolved/i.test(item)
    ),
  ]).slice(0, 8);

  const unresolvedMaterialEvidence = cleanList(input.unresolvedMaterialEvidence ?? []);
  const reviewed = normalizeCount(input.reviewedFileCount);
  const total = Math.max(normalizeCount(input.totalKnownFileCount), reviewed);
  const reviewState = getReviewCompletenessState({ reviewed, total });
  const materialFinalityGap = unresolvedMaterialEvidence.some((item) =>
    MATERIAL_FINALITY_PATTERN.test(item)
  );

  if (shouldDeferForMaterialEvidence(reviewState, materialFinalityGap, unresolvedMaterialEvidence)) {
    return {
      posture: "DEFER_FOR_MATERIAL_EVIDENCE",
      confidence: "low",
      reason: "Final award should be deferred because material amount-of-loss evidence is not ready for final-award confidence.",
      safetyCriticalSupport,
      carrierVulnerabilities,
      shopVulnerabilities,
      recommendedLanguage:
        "Defer final award until the material repair, supplement, invoice, completion, OEM, calibration, alignment, structural, or appraisal documentation is reviewed. Do not treat incomplete isolation as absence; treat it as not final-award confidence.",
    };
  }

  const shopSupportScore =
    safetyCriticalSupport.length * 3 +
    carrierVulnerabilities.length * 2 +
    cleanList(input.fileEvidenceSupportSignals ?? []).length;
  const carrierSupportScore =
    shopVulnerabilities.length * 3 +
    (carrierVulnerabilities.length === 0 ? 4 : 0) +
    (safetyCriticalSupport.length === 0 ? 1 : 0);
  const bothHaveVulnerabilities = carrierVulnerabilities.length > 0 && shopVulnerabilities.length > 0;
  const scoreDelta = shopSupportScore - carrierSupportScore;

  if (bothHaveVulnerabilities || Math.abs(scoreDelta) <= 2) {
    return buildBasis({
      posture: "RECONCILED_SUPPORTED",
      confidence: resolveConfidence(reviewState, safetyCriticalSupport.length, Math.abs(scoreDelta)),
      reason:
        "The reviewed file supports a line-adjusted amount because both estimates appear partly right or partly vulnerable.",
      safetyCriticalSupport,
      carrierVulnerabilities,
      shopVulnerabilities,
      recommendedLanguage:
        "Recommend a reconciled supported amount: award the safe, complete, OEM-consistent operations that are supported by the reviewed record, remove or reduce specifically unsupported lines, and do not use a partial award as the default appraisal outcome.",
    });
  }

  if (scoreDelta > 2) {
    return buildBasis({
      posture: "SHOP_SUPPORTED",
      confidence: resolveConfidence(reviewState, safetyCriticalSupport.length, scoreDelta),
      reason:
        "The reviewed file better supports the shop repair path because the added scope is tied to safety, repair-completeness, OEM/procedure, or completion evidence rather than breadth alone.",
      safetyCriticalSupport,
      carrierVulnerabilities,
      shopVulnerabilities,
      recommendedLanguage:
        "Based on the reviewed file, award the shop-supported repair path only to the extent it is tied to safe, complete, OEM-consistent repair, subject to any specifically unsupported line reductions listed below.",
    });
  }

  return buildBasis({
    posture: "CARRIER_SUPPORTED",
    confidence: resolveConfidence(reviewState, safetyCriticalSupport.length, Math.abs(scoreDelta)),
    reason:
      "The reviewed file does not show enough support for the broader disputed scope, and the carrier posture has fewer material repair-path vulnerabilities.",
    safetyCriticalSupport,
    carrierVulnerabilities,
    shopVulnerabilities,
    recommendedLanguage:
      "Based on the reviewed file, award the carrier-supported amount only where the broader shop items are not documented to final-award confidence and no safety, OEM, repair-completeness, or completion evidence supports adding them.",
  });
}

export function formatAppraisalAwardPosture(posture: AppraisalAwardPosture): string {
  switch (posture) {
    case "SHOP_SUPPORTED":
      return "Award shop-supported repair path";
    case "CARRIER_SUPPORTED":
      return "Award carrier-supported amount";
    case "RECONCILED_SUPPORTED":
      return "Award reconciled supported amount";
    case "DEFER_FOR_MATERIAL_EVIDENCE":
      return "Defer final award for material evidence";
  }
}

export function buildAppraisalAwardEvaluatorInstruction(): string {
  return `
Appraisal award evaluator:
- Do not award the carrier estimate merely because it is lower.
- Do not award the shop estimate merely because it is broader.
- Select the posture that best supports safe, complete, OEM-consistent repair from reviewed evidence.
- If both estimates are partly right, recommend a reconciled supported amount or line-adjusted award posture.
- Do not treat "not isolated as a standalone file" as unsupported when invoices, photos, estimate lines, scans, calibration/alignment records, test-fit/road-test notes, OEM/procedure references, or other reviewed documentation otherwise supports the operation.
- Treat incomplete final artifacts as "support present; final proof incomplete" or "not documented to final-award confidence", not as absent.
- Never expose cmp IDs, evidence chains, vector/retrieval IDs, or metadata; use plain language such as "Evidence supported." or "Support verified from reviewed file evidence."
Postures: SHOP_SUPPORTED, CARRIER_SUPPORTED, RECONCILED_SUPPORTED, DEFER_FOR_MATERIAL_EVIDENCE.`.trim();
}

function buildBasis(basis: AppraisalAwardBasis): AppraisalAwardBasis {
  return basis;
}

function shouldDeferForMaterialEvidence(
  reviewState: ReviewCompletenessState,
  materialFinalityGap: boolean,
  unresolvedMaterialEvidence: string[]
) {
  if (reviewState === "INCOMPLETE_REVIEW" || reviewState === "PARTIAL_REVIEW") {
    return true;
  }

  if (!materialFinalityGap) {
    return false;
  }

  return unresolvedMaterialEvidence.some((item) =>
    /\b(final invoice|final supplement|appraisal document|policy|structural measurement|calibration record|alignment printout)\b/i.test(item)
  );
}

function resolveConfidence(
  reviewState: ReviewCompletenessState,
  safetySupportCount: number,
  scoreMargin: number
): "low" | "moderate" | "high" {
  if (reviewState === "FULL_FILE_REVIEW_COMPLETE" && safetySupportCount > 1 && scoreMargin >= 5) {
    return "high";
  }
  if (reviewState === "NEAR_COMPLETE_REVIEW" || reviewState === "SUBSTANTIALLY_COMPLETE_REVIEW" || safetySupportCount > 0) {
    return "moderate";
  }
  return "low";
}

function cleanList(items: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const item of items) {
    const value = sanitizeUserFacingEvidenceText(item).replace(/\s+/g, " ").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(value);
  }

  return cleaned;
}

function normalizeCount(value: number | null | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value as number)) : 0;
}
