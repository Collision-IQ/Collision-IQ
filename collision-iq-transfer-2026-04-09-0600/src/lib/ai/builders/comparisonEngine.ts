import type { AnalysisFinding, AnalysisResult, EvidenceRef } from "../types/analysis";
import { buildRepairStory, type RepairStory } from "./buildRepairStory";
import { extractEstimateOps, type EstimateOperation } from "../extractors/estimateExtractor";

type ComparisonEngineParams = {
  shopEstimateText: string;
  insurerEstimateText: string;
};

export function buildComparisonAnalysis(
  params: ComparisonEngineParams
): AnalysisResult {
  const shopOperations = extractEstimateOps(params.shopEstimateText);
  const insurerOperations = extractEstimateOps(params.insurerEstimateText);
  const shopStory = buildRepairStory(params.shopEstimateText);
  const insurerStory = buildRepairStory(params.insurerEstimateText);
  const findings = buildComparisonFindings({
    shopStory,
    insurerStory,
    shopOperations,
    insurerOperations,
  });
  const evidence = buildEvidence(params, shopOperations, insurerOperations);

  return {
    mode: "comparison",
    parserStatus: "ok",
    summary: {
      riskScore: findings.some((finding) => finding.severity === "high")
        ? "high"
        : findings.some((finding) => finding.severity === "medium")
          ? "moderate"
          : "low",
      confidence:
        shopOperations.length > 0 && insurerOperations.length > 0 ? "high" : "moderate",
      criticalIssues: findings.filter((finding) => finding.severity === "high").length,
      evidenceQuality:
        shopOperations.length > 0 && insurerOperations.length > 0 ? "strong" : "moderate",
    },
    findings,
    supplements: findings.filter((finding) => finding.status !== "present"),
    evidence,
    operations: shopOperations,
    rawEstimateText: [params.shopEstimateText, params.insurerEstimateText].join("\n\n"),
    narrative: buildNarrative({
      shopStory,
      insurerStory,
      findings,
    }),
  };
}

function buildNarrative(params: {
  shopStory: RepairStory;
  insurerStory: RepairStory;
  findings: AnalysisFinding[];
}): string {
  const shopZones = params.shopStory.zones.length > 0
    ? params.shopStory.zones.join(", ")
    : "an unclear repair zone";
  const insurerZones = params.insurerStory.zones.length > 0
    ? params.insurerStory.zones.join(", ")
    : "a flatter carrier scope";

  let narrative = `Looking at both estimates as a whole, the shop estimate reads like a ${params.shopStory.complexity} involving ${shopZones}, while the carrier estimate reads more like ${insurerZones}. `;

  const keyDifferences = params.findings
    .filter((finding) => finding.status !== "present")
    .slice(0, 3)
    .map((finding) => finding.detail);

  if (keyDifferences.length > 0) {
    narrative += `${keyDifferences.join(" ")} `;
  }

  const equivalenceFinding = params.findings.find(
    (finding) => finding.category === "functional_equivalence"
  );

  if (equivalenceFinding) {
    narrative += `${equivalenceFinding.detail} `;
  }

  narrative +=
    "Only after that structural comparison should scans, calibrations, or procedure references be used as supporting context.";

  return narrative.trim();
}

function buildComparisonFindings(params: {
  shopStory: RepairStory;
  insurerStory: RepairStory;
  shopOperations: EstimateOperation[];
  insurerOperations: EstimateOperation[];
}): AnalysisFinding[] {
  const findings: AnalysisFinding[] = [];
  const scopeReduction = difference(params.shopStory.panels, params.insurerStory.panels);

  if (scopeReduction.length > 0) {
    findings.push({
      id: "comparison-scope-reduction",
      bucket: "compliance",
      category: "scope_difference",
      title: "Carrier estimate narrows repair scope",
      detail: `Panels visible in the shop estimate but not clearly carried in the carrier estimate include ${scopeReduction
        .slice(0, 4)
        .join(", ")}.`,
      severity: scopeReduction.length >= 3 ? "high" : "medium",
      status: "not_detected",
      evidence: [],
    });
  }

  const laborDifference = buildLaborDifference(params.shopStory, params.insurerStory);
  if (laborDifference) {
    findings.push(laborDifference);
  }

  if (params.shopStory.structural && !params.insurerStory.structural) {
    findings.push({
      id: "comparison-structural-classification",
      bucket: "critical",
      category: "structural_difference",
      title: "Carrier estimate downshifts structural classification",
      detail:
        "The shop estimate reads as structural or reinforced work, while the carrier estimate reads closer to a non-structural version of the same repair.",
      severity: "high",
      status: "not_detected",
      evidence: [],
    });
  }

  const processDifference = buildProcessDifference(params.shopStory, params.insurerStory);
  if (processDifference) {
    findings.push(processDifference);
  }

  const equivalenceFinding = buildEquivalenceFinding(
    params.shopOperations,
    params.insurerOperations
  );
  if (equivalenceFinding) {
    findings.push(equivalenceFinding);
  }

  if (findings.length === 0) {
    findings.push({
      id: "comparison-general-alignment",
      bucket: "quality",
      category: "story_alignment",
      title: "Repair stories are broadly aligned",
      detail:
        "The shop and carrier estimates tell a similar repair story at the structural level, even if some wording and line placement differ.",
      severity: "low",
      status: "present",
      evidence: [],
    });
  }

  return findings;
}

function buildLaborDifference(
  shopStory: RepairStory,
  insurerStory: RepairStory
): AnalysisFinding | null {
  const shopBody = shopStory.laborStructure.bodyHours ?? 0;
  const insurerBody = insurerStory.laborStructure.bodyHours ?? 0;
  const shopPaint = shopStory.laborStructure.paintHours ?? 0;
  const insurerPaint = insurerStory.laborStructure.paintHours ?? 0;
  const bodyDelta = shopBody - insurerBody;
  const paintDelta = shopPaint - insurerPaint;

  if (bodyDelta <= 0 && paintDelta <= 0) {
    return null;
  }

  const details: string[] = [];
  if (bodyDelta > 0) {
    details.push(`body labor appears reduced by about ${trimHours(bodyDelta)} hours`);
  }
  if (paintDelta > 0) {
    details.push(`paint/refinish labor appears reduced by about ${trimHours(paintDelta)} hours`);
  }

  return {
    id: "comparison-labor-structure",
    bucket: "compliance",
    category: "labor_difference",
    title: "Carrier estimate carries lighter labor structure",
    detail: `${details.join(" and ")}. That reads more like a compressed repair plan than a simple wording change.`,
    severity: bodyDelta >= 2 || paintDelta >= 2 ? "high" : "medium",
    status: "not_detected",
    evidence: [],
  };
}

function buildProcessDifference(
  shopStory: RepairStory,
  insurerStory: RepairStory
): AnalysisFinding | null {
  const replaceShift =
    shopStory.laborStructure.mix.replace - insurerStory.laborStructure.mix.replace;
  const repairShift =
    insurerStory.laborStructure.mix.repair - shopStory.laborStructure.mix.repair;

  if (replaceShift <= 0 && repairShift <= 0) {
    return null;
  }

  return {
    id: "comparison-process-shift",
    bucket: "quality",
    category: "process_difference",
    title: "Carrier estimate appears restructured rather than simply shortened",
    detail:
      replaceShift > 0 && repairShift > 0
        ? "The carrier version appears to trade replacement depth for more repair-style language, which can change the process without looking like a direct omission."
        : "The process structure changes between the two estimates, which suggests reduction or reframing rather than a one-line difference.",
    severity: replaceShift > 1 ? "high" : "medium",
    status: "unclear",
    evidence: [],
  };
}

function buildEquivalenceFinding(
  shopOperations: EstimateOperation[],
  insurerOperations: EstimateOperation[]
): AnalysisFinding | null {
  const shopSignatures = new Map(
    shopOperations.map((operation) => [buildSignature(operation.component), operation] as const)
  );
  const insurerSignatures = new Map(
    insurerOperations.map((operation) => [buildSignature(operation.component), operation] as const)
  );

  const equivalentPairs = [...shopSignatures.entries()]
    .filter(([signature]) => insurerSignatures.has(signature))
    .map(([signature, shopOperation]) => ({
      shop: shopOperation,
      insurer: insurerSignatures.get(signature)!,
    }))
    .filter(
      ({ shop, insurer }) =>
        normalizeText(shop.component) !== normalizeText(insurer.component) ||
        shop.operation !== insurer.operation
    );

  if (equivalentPairs.length === 0) {
    return null;
  }

  const sample = equivalentPairs[0];

  return {
    id: "comparison-functional-equivalence",
    bucket: "quality",
    category: "functional_equivalence",
    title: "Some operations appear functionally equivalent despite different wording",
    detail: `For example, "${sample.shop.component}" in the shop estimate appears to match "${sample.insurer.component}" in the carrier estimate, even though the wording or operation code differs.`,
    severity: "low",
    status: "present",
    evidence: [],
  };
}

function buildEvidence(
  params: ComparisonEngineParams,
  shopOperations: EstimateOperation[],
  insurerOperations: EstimateOperation[]
): EvidenceRef[] {
  const evidence: EvidenceRef[] = [
    {
      source: "shop-estimate",
      quote: params.shopEstimateText.slice(0, 280),
    },
    {
      source: "carrier-estimate",
      quote: params.insurerEstimateText.slice(0, 280),
    },
  ];

  if (shopOperations[0]) {
    evidence.push({
      source: "shop-estimate",
      quote: shopOperations[0].rawLine,
    });
  }

  if (insurerOperations[0]) {
    evidence.push({
      source: "carrier-estimate",
      quote: insurerOperations[0].rawLine,
    });
  }

  return evidence;
}

function difference(left: string[], right: string[]): string[] {
  const rightSet = new Set(right.map(normalizeText));
  return left.filter((value) => !rightSet.has(normalizeText(value)));
}

function buildSignature(value: string): string {
  return normalizeText(value)
    .replace(/\b(front|rear|left|right|lh|rh|assy|assembly|outer|inner)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function trimHours(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}
