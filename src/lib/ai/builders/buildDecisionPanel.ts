import { calculateDV } from "./dvCalculator";
import { generateNegotiationResponse } from "./negotiationEngine";
import { detectAppraisalOpportunity } from "./appraisalEngine";
import { buildSupplementLines, type SupplementLine } from "./supplementBuilder";
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
    confidence: "low" | "medium" | "high";
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

function buildDV(
  result: AnalysisResult
): DecisionPanel["diminishedValue"] | undefined {
  const text = [
    ...result.findings.map((finding) => `${finding.title} ${finding.detail}`),
    ...result.evidence.map((entry) => `${entry.source} ${entry.quote ?? ""}`),
  ].join(" ");

  const structural = includesAny(text.toLowerCase(), [
    "structural",
    "frame",
    "rail",
    "pillar",
    "apron",
    "section",
    "unibody",
  ]);

  const airbag = includesAny(text.toLowerCase(), [
    "airbag",
    "srs",
    "seat belt tensioner",
    "seat belt",
  ]);

  const dv = calculateDV({
    structural,
    airbag,
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
