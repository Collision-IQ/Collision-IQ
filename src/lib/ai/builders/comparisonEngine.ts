import type { AnalysisFinding, AnalysisResult, EvidenceRef } from "../types/analysis";
import { buildRepairStory, type RepairStory } from "./buildRepairStory";
import {
  extractEstimateOps,
  parseEstimate,
  type EstimateOperation,
  type ParsedEstimate,
} from "../extractors/estimateExtractor";
import type { WorkspaceEstimateComparisons } from "@/types/workspaceTypes";
import { buildWorkspaceEstimateComparisonSummary } from "@/lib/workspace/estimateComparisons";

type ComparisonEngineParams = {
  shopEstimateText: string;
  insurerEstimateText: string;
};

export function buildComparisonAnalysis(
  params: ComparisonEngineParams
): AnalysisResult {
  const shopEstimate = parseEstimate(params.shopEstimateText);
  const insurerEstimate = parseEstimate(params.insurerEstimateText);
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
    estimateComparisons: buildEstimateComparisons({
      shopEstimate,
      insurerEstimate,
      shopStory,
      insurerStory,
      shopOperations,
      insurerOperations,
      findings,
    }),
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

function buildEstimateComparisons(params: {
  shopEstimate: ParsedEstimate;
  insurerEstimate: ParsedEstimate;
  shopStory: RepairStory;
  insurerStory: RepairStory;
  shopOperations: EstimateOperation[];
  insurerOperations: EstimateOperation[];
  findings: AnalysisFinding[];
}): WorkspaceEstimateComparisons {
  const rows: WorkspaceEstimateComparisons["rows"] = [];
  const comparisonPairs = buildOperationPairs(params.shopOperations, params.insurerOperations);

  if (
    typeof params.shopEstimate.totalCost === "number" ||
    typeof params.insurerEstimate.totalCost === "number"
  ) {
    rows.push({
      id: "estimate-total",
      category: "Estimate",
      operation: "Estimate total",
      lhsSource: "Shop estimate",
      rhsSource: "Carrier estimate",
      lhsValue: params.shopEstimate.totalCost ?? null,
      rhsValue: params.insurerEstimate.totalCost ?? null,
      delta:
        typeof params.shopEstimate.totalCost === "number" &&
        typeof params.insurerEstimate.totalCost === "number"
          ? Number((params.shopEstimate.totalCost - params.insurerEstimate.totalCost).toFixed(2))
          : null,
      valueUnit: "currency",
      deltaType: resolveDeltaType(
        params.shopEstimate.totalCost ?? null,
        params.insurerEstimate.totalCost ?? null
      ),
      confidence: 0.98,
      notes: ["Derived from parsed estimate totals."],
    });
  }

  if (
    typeof params.shopStory.laborStructure.bodyHours === "number" ||
    typeof params.insurerStory.laborStructure.bodyHours === "number"
  ) {
    rows.push({
      id: "labor-body-hours",
      category: "Labor",
      operation: "Body labor hours",
      lhsSource: "Shop estimate",
      rhsSource: "Carrier estimate",
      lhsValue: params.shopStory.laborStructure.bodyHours ?? null,
      rhsValue: params.insurerStory.laborStructure.bodyHours ?? null,
      delta:
        typeof params.shopStory.laborStructure.bodyHours === "number" &&
        typeof params.insurerStory.laborStructure.bodyHours === "number"
          ? Number(
              (
                params.shopStory.laborStructure.bodyHours -
                params.insurerStory.laborStructure.bodyHours
              ).toFixed(1)
            )
          : null,
      valueUnit: "hours",
      deltaType: resolveDeltaType(
        params.shopStory.laborStructure.bodyHours ?? null,
        params.insurerStory.laborStructure.bodyHours ?? null
      ),
      confidence: 0.95,
      notes: findNotes(params.findings, "labor_difference"),
    });
  }

  if (
    typeof params.shopStory.laborStructure.paintHours === "number" ||
    typeof params.insurerStory.laborStructure.paintHours === "number"
  ) {
    rows.push({
      id: "labor-paint-hours",
      category: "Refinish",
      operation: "Paint / refinish hours",
      lhsSource: "Shop estimate",
      rhsSource: "Carrier estimate",
      lhsValue: params.shopStory.laborStructure.paintHours ?? null,
      rhsValue: params.insurerStory.laborStructure.paintHours ?? null,
      delta:
        typeof params.shopStory.laborStructure.paintHours === "number" &&
        typeof params.insurerStory.laborStructure.paintHours === "number"
          ? Number(
              (
                params.shopStory.laborStructure.paintHours -
                params.insurerStory.laborStructure.paintHours
              ).toFixed(1)
            )
          : null,
      valueUnit: "hours",
      deltaType: resolveDeltaType(
        params.shopStory.laborStructure.paintHours ?? null,
        params.insurerStory.laborStructure.paintHours ?? null
      ),
      confidence: 0.95,
      notes: findNotes(params.findings, "labor_difference"),
    });
  }

  comparisonPairs.forEach((pair, index) => {
    const quantifiedRow = buildOperationLaborComparisonRow(pair, index);
    if (quantifiedRow) {
      rows.push(quantifiedRow);
    }

    const row = buildOperationComparisonRow(pair, params.findings, index);
    if (row) {
      rows.push(row);
    }
  });

  return { rows, summary: buildWorkspaceEstimateComparisonSummary(rows) };
}

function buildOperationPairs(
  shopOperations: EstimateOperation[],
  insurerOperations: EstimateOperation[]
) {
  const insurerBySignature = new Map(
    insurerOperations.map((operation, index) => [
      `${buildSignature(operation.component)}:${index}`,
      operation,
    ] as const)
  );
  const insurerUnused = new Set(insurerBySignature.keys());
  const pairs: Array<{
    shop?: EstimateOperation;
    insurer?: EstimateOperation;
  }> = [];

  shopOperations.forEach((shopOperation) => {
    const signature = buildSignature(shopOperation.component);
    const insurerMatchKey = [...insurerUnused].find((key) => key.startsWith(`${signature}:`));
    if (insurerMatchKey) {
      pairs.push({
        shop: shopOperation,
        insurer: insurerBySignature.get(insurerMatchKey),
      });
      insurerUnused.delete(insurerMatchKey);
      return;
    }

    pairs.push({ shop: shopOperation });
  });

  [...insurerUnused]
    .map((key) => insurerBySignature.get(key))
    .filter((operation): operation is EstimateOperation => Boolean(operation))
    .forEach((insurerOperation) => {
      pairs.push({ insurer: insurerOperation });
    });

  return pairs;
}

function buildOperationComparisonRow(
  pair: {
    shop?: EstimateOperation;
    insurer?: EstimateOperation;
  },
  findings: AnalysisFinding[],
  index: number
) {
  const shop = pair.shop;
  const insurer = pair.insurer;
  const lhsValue = shop ? formatOperationValue(shop) : null;
  const rhsValue = insurer ? formatOperationValue(insurer) : null;
  const deltaType = resolveDeltaType(lhsValue, rhsValue);
  const notes = [
    ...findNotes(findings, inferFindingCategory(shop, insurer)),
    ...findNotes(findings, "functional_equivalence"),
  ].slice(0, 2);

  if (!shop && !insurer) {
    return null;
  }

  return {
    id: `operation-${index + 1}`,
    category: classifyOperationCategory(shop ?? insurer!),
    operation: shop?.operation ?? insurer?.operation,
    partName: shop?.component ?? insurer?.component,
    lhsSource: "Shop estimate",
    rhsSource: "Carrier estimate",
    lhsValue,
    rhsValue,
    delta: buildOperationDelta(shop, insurer, deltaType),
    deltaType,
    confidence: shop && insurer ? 0.92 : 0.82,
    notes,
  };
}

function buildOperationLaborComparisonRow(
  pair: {
    shop?: EstimateOperation;
    insurer?: EstimateOperation;
  },
  index: number
) {
  const shop = pair.shop;
  const insurer = pair.insurer;

  if (
    typeof shop?.laborHours !== "number" &&
    typeof insurer?.laborHours !== "number"
  ) {
    return null;
  }

  return {
    id: `operation-labor-${index + 1}`,
    category: classifyOperationCategory(shop ?? insurer!),
    operation: `${shop?.component ?? insurer?.component ?? "Operation"} labor hours`,
    partName: shop?.component ?? insurer?.component,
    lhsSource: "Shop estimate",
    rhsSource: "Carrier estimate",
    lhsValue: shop?.laborHours ?? null,
    rhsValue: insurer?.laborHours ?? null,
    delta:
      typeof shop?.laborHours === "number" && typeof insurer?.laborHours === "number"
        ? Number((shop.laborHours - insurer.laborHours).toFixed(1))
        : null,
    valueUnit: "hours" as const,
    deltaType: resolveDeltaType(shop?.laborHours ?? null, insurer?.laborHours ?? null),
    confidence: shop && insurer ? 0.94 : 0.86,
    notes: ["Derived from parsed operation labor hours."],
  };
}

function formatOperationValue(operation: EstimateOperation): string {
  return `${operation.operation} ${operation.component}`.trim();
}

function buildOperationDelta(
  shop: EstimateOperation | undefined,
  insurer: EstimateOperation | undefined,
  deltaType: WorkspaceEstimateComparisons["rows"][number]["deltaType"]
) {
  if (deltaType === "added") return "Present only in shop estimate";
  if (deltaType === "removed") return "Present only in carrier estimate";
  if (deltaType === "same") return "Aligned";
  if (shop && insurer && shop.operation !== insurer.operation) {
    return `${shop.operation} -> ${insurer.operation}`;
  }
  return "Changed";
}

function resolveDeltaType(
  lhsValue: string | number | null,
  rhsValue: string | number | null
): WorkspaceEstimateComparisons["rows"][number]["deltaType"] {
  if (lhsValue !== null && lhsValue !== undefined && (rhsValue === null || rhsValue === undefined)) {
    return "added";
  }
  if ((lhsValue === null || lhsValue === undefined) && rhsValue !== null && rhsValue !== undefined) {
    return "removed";
  }
  if (lhsValue === null || lhsValue === undefined || rhsValue === null || rhsValue === undefined) {
    return "unknown";
  }
  if (`${lhsValue}`.trim() === `${rhsValue}`.trim()) {
    return "same";
  }
  return "changed";
}

function classifyOperationCategory(operation: EstimateOperation): string {
  const text = `${operation.operation} ${operation.component} ${operation.rawLine}`.toLowerCase();

  if (/(scan|calibration|adas|sensor|camera|radar)/.test(text)) return "ADAS";
  if (/(paint|refinish|blend|mask|sand|polish|tint)/.test(text)) return "Refinish";
  if (/(rail|pillar|apron|support|structural|measure|pull)/.test(text)) return "Structural";
  if (/(align|alignment)/.test(text)) return "Alignment";
  if (/(proc|procedure|test|quality check|road test)/.test(text)) return "Procedure";
  return "Operations";
}

function inferFindingCategory(
  shop: EstimateOperation | undefined,
  insurer: EstimateOperation | undefined
): string {
  const text = `${shop?.rawLine ?? ""} ${insurer?.rawLine ?? ""}`.toLowerCase();
  if (/(rail|pillar|apron|support|structural)/.test(text)) return "structural_difference";
  return "scope_difference";
}

function findNotes(findings: AnalysisFinding[], category: string): string[] {
  return findings
    .filter((finding) => finding.category === category)
    .map((finding) => finding.detail)
    .filter(Boolean)
    .slice(0, 2);
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
