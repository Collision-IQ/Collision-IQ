import { calculateDV } from "./dvCalculator";
import { generateNegotiationResponse } from "./negotiationEngine";
import { detectAppraisalOpportunity } from "./appraisalEngine";
import {
  buildSupplementLines,
  buildSupplementLinesHybrid,
  validateSupplements,
  type SupplementValidationContext,
  type SupplementLine,
} from "./supplementBuilder";
import { mapSupplementLines } from "./lineMappingEngine";
import { buildStateLeverage } from "./stateLeverageEngine";
import type { AnalysisResult } from "../types/analysis";
import {
  deriveStructuralApplicabilityFromResult,
  filterStructuralTitles,
} from "../structuralApplicability";

export type DecisionPanel = {
  narrative: string;
  supplements: Array<
    SupplementLine & {
      mappedLabel?: string;
    }
  >;
  diminishedValue?: {
    low: number;
    high: number;
    confidence: "low" | "medium" | "high" | "low_to_moderate";
    rationale: string;
  };
  negotiationResponse?: string;
  appraisal?: {
    triggered: boolean;
    reasoning: string;
  };
  stateLeverage?: string[];
};

export function buildDecisionPanel(result: AnalysisResult): DecisionPanel {
  const supplements = buildSupplementLines(result);
  const mappedLines = mapSupplementLines(supplements, "ccc");
  const diminishedValue = buildDV(result);
  const negotiationResponse = generateNegotiationResponse(result);
  const appraisal = detectAppraisalOpportunity(result);
  const stateLeverage = buildStateLeverage().points;

  const supplementsWithMappedLabels = finalizeDecisionPanelSupplements(
    supplements.map((supplement, index) => ({
      ...supplement,
      mappedLabel: mappedLines[index]?.label,
    })),
    result.rawEstimateText ?? ""
  );

  return {
    narrative: result.narrative,
    supplements: supplementsWithMappedLabels,
    ...(diminishedValue ? { diminishedValue } : {}),
    ...(negotiationResponse ? { negotiationResponse } : {}),
    appraisal: {
      triggered: appraisal.shouldRecommend,
      reasoning: appraisal.reasons.join(". "),
    },
    ...(stateLeverage.length > 0 ? { stateLeverage } : {}),
  };
}

export async function buildDecisionPanelHybrid(params: {
  result: AnalysisResult;
  supplementCandidates: Array<{ title: string; reason: string }>;
  supplementContext?: SupplementValidationContext;
}): Promise<DecisionPanel> {
  const structurallyScopedCandidates = filterStructuralTitles(
    params.supplementCandidates,
    deriveStructuralApplicabilityFromResult(params.result)
  );
  const validCandidates = validateSupplements(
    params.result.rawEstimateText ?? "",
    structurallyScopedCandidates,
    params.supplementContext
  );
  const supplements = buildSupplementLinesHybrid(
    validCandidates,
    params.result.rawEstimateText ?? ""
  );
  const mappedLines = mapSupplementLines(supplements, "ccc");
  const diminishedValue = buildDV(params.result);
  const negotiationResponse = generateNegotiationResponse(params.result);
  const appraisal = detectAppraisalOpportunity(params.result);
  const stateLeverage = buildStateLeverage().points;

  const supplementsWithMappedLabels = finalizeDecisionPanelSupplements(
    supplements.map((supplement, index) => ({
      ...supplement,
      mappedLabel: mappedLines[index]?.label,
    })),
    params.result.rawEstimateText ?? ""
  );

  return {
    narrative: params.result.narrative,
    supplements: supplementsWithMappedLabels,
    ...(diminishedValue ? { diminishedValue } : {}),
    ...(negotiationResponse ? { negotiationResponse } : {}),
    appraisal: {
      triggered: appraisal.shouldRecommend,
      reasoning: appraisal.reasons.join(". "),
    },
    ...(stateLeverage.length > 0 ? { stateLeverage } : {}),
  };
}

function finalizeDecisionPanelSupplements(
  supplements: Array<SupplementLine & { mappedLabel?: string }>,
  evidenceText: string
): Array<SupplementLine & { mappedLabel?: string }> {
  const lowerEvidence = evidenceText.toLowerCase();
  const filtered = supplements.filter((item) => {
    const title = item.mappedLabel ?? item.title;

    if (title === "Four-Wheel Alignment" && !hasDecisionPanelAlignmentEvidence(lowerEvidence)) {
      return false;
    }
    if (
      title === "One-Time-Use Hardware / Seals / Clips" &&
      !hasDecisionPanelHardwareEvidence(lowerEvidence)
    ) {
      return false;
    }
    return true;
  });

  const ranked = [...filtered].sort(
    (left, right) =>
      scoreDecisionPanelSupplement(right) - scoreDecisionPanelSupplement(left)
  );
  const kept: Array<SupplementLine & { mappedLabel?: string }> = [];
  const seenFamilies = new Set<string>();
  let genericFallbacks = 0;

  for (const item of ranked) {
    const title = item.mappedLabel ?? item.title;
    const family = inferDecisionPanelSupplementFamily(title);
    const generic = isDecisionPanelGenericFallback(title);

    if (seenFamilies.has(family)) {
      continue;
    }
    if (generic && genericFallbacks >= 1) {
      continue;
    }

    kept.push(item);
    seenFamilies.add(family);
    if (generic) genericFallbacks += 1;
  }

  return kept;
}

function inferDecisionPanelSupplementFamily(title: string): string {
  const lower = title.toLowerCase();

  if (
    lower.includes("front structure") ||
    lower.includes("tie bar") ||
    lower.includes("lock support") ||
    lower.includes("core support") ||
    lower.includes("upper rail") ||
    lower.includes("hidden mounting")
  ) {
    return "front_structure_scope";
  }
  if (
    lower.includes("rear body") ||
    lower.includes("deck opening") ||
    lower.includes("bumper reinforcement") ||
    lower.includes("rear sensor") ||
    lower.includes("blind spot") ||
    lower.includes("deck lid") ||
    lower.includes("latch") ||
    lower.includes("striker")
  ) {
    return "rear_structure_scope";
  }
  if (lower.includes("test fit") || lower.includes("fit-sensitive")) return "fit_verification";
  if (lower.includes("alignment")) return "alignment";
  if (lower.includes("hardware") || lower.includes("clip") || lower.includes("fastener")) return "hardware";
  if (lower.includes("measure") || lower.includes("setup") || lower.includes("realignment")) {
    return "structural_measurement";
  }
  if (lower.includes("scan") || lower.includes("calibration") || lower.includes("sensor") || lower.includes("aim")) {
    return "verification";
  }
  if (lower.includes("corrosion") || lower.includes("seam") || lower.includes("weld")) {
    return "corrosion";
  }
  return title.toLowerCase();
}

function isDecisionPanelGenericFallback(title: string): boolean {
  return [
    "Four-Wheel Alignment",
    "One-Time-Use Hardware / Seals / Clips",
    "Structural Measurement Verification",
    "Hidden Mounting Geometry / Teardown Growth",
  ].includes(title);
}

function scoreDecisionPanelSupplement(
  item: SupplementLine & { mappedLabel?: string }
): number {
  const lower = `${item.mappedLabel ?? item.title} ${item.rationale}`.toLowerCase();
  let score = item.rationale.length;

  if (lower.includes("front structure") || lower.includes("tie bar") || lower.includes("lock support")) score += 80;
  if (lower.includes("rear body") || lower.includes("deck opening") || lower.includes("bumper reinforcement")) score += 80;
  if (lower.includes("test fit") || lower.includes("fit-sensitive")) score += 45;
  if (lower.includes("sensor") || lower.includes("radar") || lower.includes("calibration")) score += 35;
  if (isDecisionPanelGenericFallback(item.mappedLabel ?? item.title)) score -= 35;

  return score;
}

function hasDecisionPanelAlignmentEvidence(value: string): boolean {
  return (
    value.includes("alignment") ||
    value.includes("toe") ||
    value.includes("camber") ||
    value.includes("caster") ||
    value.includes("suspension") ||
    value.includes("steering") ||
    value.includes("subframe")
  );
}

function hasDecisionPanelHardwareEvidence(value: string): boolean {
  return (
    value.includes("one-time-use") ||
    value.includes("one time use") ||
    value.includes("hardware") ||
    value.includes("fastener") ||
    value.includes("retainer") ||
    /\bclip(s)?\b/i.test(value) ||
    /\bseal(s)?\b/i.test(value)
  );
}

function buildDV(
  result: AnalysisResult
): DecisionPanel["diminishedValue"] | undefined {
  const text = [
    ...result.findings.map((finding) => `${finding.title} ${finding.detail}`),
    ...result.evidence.map((entry) => `${entry.source} ${entry.quote ?? ""}`),
    result.rawEstimateText ?? "",
    result.narrative ?? "",
  ].join(" ");
  const lower = text.toLowerCase();
  const repairCost = extractRepairCost(lower);
  const structural = detectStructural(lower);

  const dv = calculateDV({
    repairCost,
    structural,
    airbag: false,
    adas: false,
    hybrid: false,
    multiPanel: false,
  });

  if (!dv) return undefined;

  return {
    low: dv.low,
    high: dv.high,
    confidence: dv.confidence,
    rationale: dv.rationale,
  };
}

function includesAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function detectStructural(text: string): boolean {
  return includesAny(text, [
    "structural",
    "frame",
    "rail",
    "pillar",
    "apron",
    "section",
    "unibody",
  ]);
}

function extractRepairCost(text: string): number | undefined {
  const matches = [...text.matchAll(/\$?\s*([\d,]+\.\d{2})/g)];
  const values = matches
    .map((match) => Number.parseFloat(match[1].replace(/,/g, "")))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!values.length) return undefined;
  return Math.max(...values);
}
