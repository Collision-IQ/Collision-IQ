import { buildRepairStory } from "./buildRepairStory";
import type { AnalysisResult } from "../types/analysis";
import type { EstimateOperation } from "../extractors/estimateExtractor";

export function buildRepairStoryComparison(params: {
  shopEstimateText: string;
  insurerEstimateText: string;
  shopOperations: EstimateOperation[];
  insurerOperations: EstimateOperation[];
}): AnalysisResult {
  const shopStory = buildRepairStory(params.shopEstimateText);
  const insurerStory = buildRepairStory(params.insurerEstimateText);

  const findings = buildStructuralFindings({
    shopStory,
    insurerStory,
    shopOperations: params.shopOperations,
    insurerOperations: params.insurerOperations,
  });

  const narrative = buildComparisonNarrative({
    shopStory,
    insurerStory,
    shopOperations: params.shopOperations,
    insurerOperations: params.insurerOperations,
  });

  return {
    mode: "comparison",
    parserStatus: "ok",
    summary: {
      riskScore: findings.some((finding) => finding.severity === "high") ? "high" : "moderate",
      confidence: params.shopOperations.length > 0 && params.insurerOperations.length > 0 ? "high" : "moderate",
      criticalIssues: findings.filter((finding) => finding.severity === "high").length,
      evidenceQuality: "moderate",
    },
    findings,
    supplements: findings.filter((finding) => finding.status !== "present"),
    evidence: [
      { source: "shop-estimate", quote: params.shopEstimateText.slice(0, 500) },
      { source: "carrier-estimate", quote: params.insurerEstimateText.slice(0, 500) },
    ],
    operations: params.shopOperations,
    rawEstimateText: params.shopEstimateText,
    narrative,
  };
}

function buildComparisonNarrative(params: {
  shopStory: ReturnType<typeof buildRepairStory>;
  insurerStory: ReturnType<typeof buildRepairStory>;
  shopOperations: EstimateOperation[];
  insurerOperations: EstimateOperation[];
}): string {
  const shopZones = params.shopStory.zones.length > 0
    ? params.shopStory.zones.join(", ")
    : "unclear repair zones";
  const insurerZones = params.insurerStory.zones.length > 0
    ? params.insurerStory.zones.join(", ")
    : "a less clearly defined scope";

  let narrative = `Looking at both estimates as a whole, the shop estimate reads like a ${params.shopStory.complexity} involving ${shopZones}, while the carrier estimate reads more like ${insurerZones}. `;

  if (
    params.shopStory.structural &&
    !params.insurerStory.structural
  ) {
    narrative += "The key difference is structural depth: the shop estimate signals structural complexity, while the carrier estimate does not reflect that same level of repair structure. ";
  }

  if (params.shopOperations.length > params.insurerOperations.length) {
    narrative += "The bigger issue is not one missing line at a time - it is that the carrier version appears compressed compared with how the shop estimate structures the repair. ";
  } else {
    narrative += "The broad scope is closer than the line-item debate suggests, but the structure and support still matter more than isolated wording differences. ";
  }

  narrative += "That is where the real difference sits: repair structure, not just item count.";

  return narrative.trim();
}

function buildStructuralFindings(params: {
  shopStory: ReturnType<typeof buildRepairStory>;
  insurerStory: ReturnType<typeof buildRepairStory>;
  shopOperations: EstimateOperation[];
  insurerOperations: EstimateOperation[];
}): AnalysisResult["findings"] {
  const findings: AnalysisResult["findings"] = [];

  if (params.shopOperations.length > params.insurerOperations.length) {
    findings.push({
      id: "story-scope-compression",
      bucket: "compliance",
      category: "story_difference",
      title: "Carrier estimate appears compressed in repair structure",
      detail:
        "The shop estimate carries more visible repair operations, which suggests the carrier estimate may be reduced in structural depth rather than just word choice.",
      severity: "high",
      status: "not_detected",
      evidence: [],
    });
  }

  if (params.shopStory.structural && !params.insurerStory.structural) {
    findings.push({
      id: "story-structural-depth",
      bucket: "critical",
      category: "story_difference",
      title: "Structural complexity appears underrepresented in carrier estimate",
      detail:
        "The shop estimate signals structural involvement, while the carrier estimate does not appear to carry the same structural framing.",
      severity: "high",
      status: "not_detected",
      evidence: [],
    });
  }

  if (findings.length === 0) {
    findings.push({
      id: "story-alignment",
      bucket: "quality",
      category: "story_alignment",
      title: "Repair story appears generally aligned",
      detail:
        "At a high level, both estimates point to a similar repair story, though support depth and line structure may still matter.",
      severity: "low",
      status: "present",
      evidence: [],
    });
  }

  return findings;
}
