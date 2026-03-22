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

  const supplementsWithMappedLabels = supplements.map((supplement, index) => ({
    ...supplement,
    mappedLabel: mappedLines[index]?.label,
  }));

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
  const validCandidates = validateSupplements(
    params.result.rawEstimateText ?? "",
    params.supplementCandidates,
    params.supplementContext
  );
  const supplements = buildSupplementLinesHybrid(validCandidates);
  const mappedLines = mapSupplementLines(supplements, "ccc");
  const diminishedValue = buildDV(params.result);
  const negotiationResponse = generateNegotiationResponse(params.result);
  const appraisal = detectAppraisalOpportunity(params.result);
  const stateLeverage = buildStateLeverage().points;

  const supplementsWithMappedLabels = supplements.map((supplement, index) => ({
    ...supplement,
    mappedLabel: mappedLines[index]?.label,
  }));

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
