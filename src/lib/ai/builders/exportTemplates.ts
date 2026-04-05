import {
  buildExportModel,
  buildPreferredRebuttalSubjectVehicleLabel,
  buildPreferredVehicleIdentityLabel,
  type ExportModel,
  type ExportSupplementItem,
} from "./buildExportModel";
import type { DecisionPanel } from "./buildDecisionPanel";
import type { AnalysisResult, RepairIntelligenceReport } from "../types/analysis";

export type ExportTemplateSourceModel = {
  exportModel: ExportModel;
  analysisMode: AnalysisResult["mode"] | "single-document-review";
  generatedLabel: string;
  categoryComparisons: ExportCategoryComparison[];
  lineItems: ExportLineComparison[];
};

export type ExportCategoryComparison = {
  category: string;
  shopPosition: string;
  carrierPosition: string;
  supportStatus: "supported" | "underwritten" | "missing" | "disputed";
  rationale: string;
  supportingFields: string[];
};

export type ExportLineComparison = {
  operation: string;
  component: string;
  rawLine?: string;
  carrierPosition: string;
  supportStatus: "supported" | "underwritten" | "missing" | "disputed";
  rationale: string;
  support?: string;
};

export function formatAnalysisModeLabel(
  mode: AnalysisResult["mode"] | "single-document-review" | undefined
): string {
  switch (mode) {
    case "comparison":
      return "Comparison Review";
    case "single-document-review":
      return "Single Estimate Review";
    case "parser-incomplete":
      return "Estimate Review";
    default:
      return "Estimate Review";
  }
}

export function buildExportTemplateSourceModel(params: {
  report: RepairIntelligenceReport | null;
  analysis: AnalysisResult | null;
  panel: DecisionPanel | null;
  assistantAnalysis?: string | null;
}): ExportTemplateSourceModel {
  const exportModel = buildExportModel(params);
  const source: ExportTemplateSourceModel = {
    exportModel,
    analysisMode: params.analysis?.mode ?? params.report?.analysis?.mode ?? "single-document-review",
    generatedLabel: new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    categoryComparisons: buildCategoryComparisons(exportModel),
    lineItems: buildLineItems(exportModel, params.analysis),
  };

  if (source.categoryComparisons.length === 0) {
    source.categoryComparisons = [
      {
        category: "Overall Repair Position",
        shopPosition: exportModel.repairPosition,
        carrierPosition: exportModel.positionStatement,
        supportStatus: exportModel.supplementItems.length > 0 ? "underwritten" : "supported",
        rationale: exportModel.positionStatement,
        supportingFields: ["repairPosition", "positionStatement"],
      },
    ];
  }

  if (source.lineItems.length === 0) {
    source.lineItems = exportModel.supplementItems.slice(0, 8).map((item) => ({
      operation: item.title,
      component: formatCategoryLabel(item.category),
      carrierPosition: describeCarrierPosition(item),
      supportStatus: mapSupportStatus(item.kind),
      rationale: item.rationale,
      support: buildSupportSnippet(item),
    }));
  }

  return source;
}

export function buildRebuttalEmailTemplate(params: {
  report: RepairIntelligenceReport | null;
  analysis: AnalysisResult | null;
  panel: DecisionPanel | null;
  assistantAnalysis?: string | null;
}): string {
  const source = buildExportTemplateSourceModel(params);
  const { exportModel } = source;
  const subjectVehicle = buildPreferredRebuttalSubjectVehicleLabel(exportModel.vehicle);
  const topItems = exportModel.supplementItems.slice(0, 4);
  const asks = topItems.length > 0
    ? topItems.map((item) => `- ${item.title}: ${buildRequestSentence(item)}`)
    : ["- Please review the current repair path and provide any supporting documentation needed to confirm the intended scope."];

  return [
    `Subject: Request for estimate revision - ${subjectVehicle}`,
    "",
    "To: [Carrier Adjuster Email]",
    "CC: [Shop / File Team]",
    "",
    "Hello,",
    "",
    `After reviewing the current file, our position is that ${lowercaseFirst(exportModel.repairPosition)}`,
    "",
    "The main items that still need revision or support are:",
    ...asks,
    "",
    "Please update the estimate or provide the documentation supporting the current position on the items above.",
    "",
    "If helpful, I can send the supporting estimate excerpts and comparison notes in a follow-up.",
    "",
    "Thank you,",
    "[Your Name]",
    "[Title / Shop]",
    "[Phone / Email]",
  ].join("\n");
}

export function buildSideBySideComparisonReport(params: {
  report: RepairIntelligenceReport | null;
  analysis: AnalysisResult | null;
  panel: DecisionPanel | null;
  assistantAnalysis?: string | null;
}): string {
  const source = buildExportTemplateSourceModel(params);
  const { exportModel } = source;
  const isComparison = source.analysisMode === "comparison";
  const vehicleIdentity =
    exportModel.reportFields.vehicleLabel ??
    buildPreferredVehicleIdentityLabel(exportModel.vehicle) ??
    "Unspecified";

  const sections = source.categoryComparisons.map((category) =>
    [
      `## ${category.category}`,
      `${isComparison ? "Shop position" : "Estimate position"}: ${category.shopPosition}`,
      `${isComparison ? "Carrier position" : "Support posture"}: ${category.carrierPosition}`,
      `Support status: ${formatCategoryLabel(category.supportStatus)}`,
      `Rationale: ${category.rationale}`,
    ].join("\n")
  );

  return [
    isComparison ? "# Side-by-Side Comparison Report" : "# Estimate Review Report",
    "",
    `Generated: ${source.generatedLabel}`,
    `Vehicle: ${vehicleIdentity}`,
    `Mode: ${formatAnalysisModeLabel(source.analysisMode)}`,
    "",
    "## Overall Position",
    `Summary: ${exportModel.repairPosition}`,
    `${isComparison ? "Carrier-facing posture" : "Support posture"}: ${exportModel.positionStatement}`,
    "",
    ...sections,
  ].join("\n");
}

export function buildLineByLineComparisonReport(params: {
  report: RepairIntelligenceReport | null;
  analysis: AnalysisResult | null;
  panel: DecisionPanel | null;
  assistantAnalysis?: string | null;
}): string {
  const source = buildExportTemplateSourceModel(params);
  const { exportModel } = source;
  const isComparison = source.analysisMode === "comparison";
  const vehicleIdentity =
    exportModel.reportFields.vehicleLabel ??
    buildPreferredVehicleIdentityLabel(exportModel.vehicle) ??
    "Unspecified";

  const rows = source.lineItems.map((item, index) =>
    [
      `## Line ${index + 1}`,
      `Operation: ${item.operation}`,
      `Component: ${item.component}`,
      item.rawLine ? `Estimate line: ${item.rawLine}` : undefined,
      `Carrier position: ${item.carrierPosition}`,
      `Support status: ${formatCategoryLabel(item.supportStatus)}`,
      `Rationale: ${item.rationale}`,
      item.support ? `Support: ${item.support}` : undefined,
    ]
      .filter(Boolean)
      .join("\n")
  );

  return [
    isComparison ? "# Line-by-Line Comparison Report" : "# Line-by-Line Estimate Review",
    "",
    `Generated: ${source.generatedLabel}`,
    `Vehicle: ${vehicleIdentity}`,
    "",
    isComparison
      ? "This view focuses on estimate operations, why each line matters, and whether the current carrier-side posture appears supported, underwritten, missing, or disputed."
      : "This view focuses on estimate operations, why each line matters, and whether the current documentation reads as supported, underwritten, missing, or still uncertain.",
    "",
    ...rows,
  ].join("\n");
}

function buildCategoryComparisons(exportModel: ExportModel): ExportCategoryComparison[] {
  const grouped = new Map<string, ExportSupplementItem[]>();

  for (const item of exportModel.supplementItems) {
    const key = item.category || "general";
    const existing = grouped.get(key) ?? [];
    existing.push(item);
    grouped.set(key, existing);
  }

  return [...grouped.entries()].map(([category, items]) => {
    const topItems = items.slice(0, 3);
    const supportStatus = deriveCategorySupportStatus(items);

    return {
      category: formatCategoryLabel(category),
      shopPosition: summarizeShopCategoryPosition(topItems, exportModel.repairPosition),
      carrierPosition: summarizeCarrierCategoryPosition(topItems),
      supportStatus,
      rationale: topItems.map((item) => item.rationale).join(" "),
      supportingFields: compact([
        "repairPosition",
        "positionStatement",
        ...topItems.map((item) => item.source),
      ]),
    };
  });
}

function buildLineItems(
  exportModel: ExportModel,
  analysis: AnalysisResult | null
): ExportLineComparison[] {
  const supplementItems = exportModel.supplementItems;
  const operations = analysis?.operations ?? [];
  const matchedSupplementKeys = new Set<string>();

  const lines = operations.map((operation) => {
    const match = findBestSupplementMatch(operation.component, supplementItems);
    if (match) {
      matchedSupplementKeys.add(normalizeKey(match.title));
    }

    return {
      operation: operation.operation,
      component: operation.component,
      rawLine: operation.rawLine,
      carrierPosition: match
        ? describeCarrierPosition(match)
        : "No explicit carrier-side support gap was flagged for this operation in the current normalized analysis.",
      supportStatus: match ? mapSupportStatus(match.kind) : "supported",
      rationale: match
        ? match.rationale
        : "This line is present in the parsed estimate operations and was not singled out as a major current support gap.",
      support: match ? buildSupportSnippet(match) : undefined,
    };
  });

  const unmatchedSupplements = supplementItems
    .filter((item) => !matchedSupplementKeys.has(normalizeKey(item.title)))
    .slice(0, Math.max(0, 10 - lines.length))
    .map((item) => ({
      operation: item.title,
      component: formatCategoryLabel(item.category),
      carrierPosition: describeCarrierPosition(item),
      supportStatus: mapSupportStatus(item.kind),
      rationale: item.rationale,
      support: buildSupportSnippet(item),
    }));

  return [...lines, ...unmatchedSupplements];
}

function findBestSupplementMatch(
  component: string,
  items: ExportSupplementItem[]
): ExportSupplementItem | undefined {
  const componentTokens = tokenize(component);
  let best: ExportSupplementItem | undefined;
  let bestScore = 0;

  for (const item of items) {
    const haystack = `${item.title} ${item.rationale} ${item.evidence ?? ""}`;
    const haystackTokens = tokenize(haystack);
    const overlap = [...componentTokens].filter((token) => haystackTokens.has(token)).length;
    if (overlap > bestScore) {
      best = item;
      bestScore = overlap;
    }
  }

  return bestScore >= 1 ? best : undefined;
}

function tokenize(value: string): Set<string> {
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "this",
    "that",
    "from",
    "into",
    "line",
    "repair",
    "estimate",
  ]);

  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !stopWords.has(token))
  );
}

function summarizeShopCategoryPosition(
  items: ExportSupplementItem[],
  repairPosition: string
): string {
  if (items.length === 0) {
    return repairPosition;
  }

  return `The shop-side repair path supports ${joinHumanList(items.map((item) => item.title.toLowerCase()))}.`;
}

function summarizeCarrierCategoryPosition(items: ExportSupplementItem[]): string {
  if (items.length === 0) {
    return "No clear unsupported variance was identified in this category from the current normalized analysis.";
  }

  return items.map((item) => describeCarrierPosition(item)).join(" ");
}

function deriveCategorySupportStatus(
  items: ExportSupplementItem[]
): ExportCategoryComparison["supportStatus"] {
  if (items.some((item) => item.kind === "missing_operation")) return "missing";
  if (items.some((item) => item.kind === "disputed_repair_path")) return "disputed";
  if (items.some((item) => item.kind === "underwritten_operation" || item.kind === "missing_verification")) {
    return "underwritten";
  }
  return "supported";
}

function describeCarrierPosition(item: ExportSupplementItem): string {
  switch (item.kind) {
    case "missing_operation":
      return `${item.title} is not clearly carried in the current estimate posture.`;
    case "missing_verification":
      return `${item.title} may be implicitly required, but the current verification or documentation is not clearly shown.`;
    case "underwritten_operation":
      return `${item.title} appears lighter or under-supported in the current estimate.`;
    default:
      return `${item.title} reflects a repair-path position that still needs clearer support in the current file.`;
  }
}

function mapSupportStatus(
  kind: ExportSupplementItem["kind"]
): ExportLineComparison["supportStatus"] {
  switch (kind) {
    case "missing_operation":
      return "missing";
    case "underwritten_operation":
    case "missing_verification":
      return "underwritten";
    case "disputed_repair_path":
      return "disputed";
    default:
      return "supported";
  }
}

function buildSupportSnippet(item: ExportSupplementItem): string | undefined {
  if (item.evidence && item.source) {
    return `${item.evidence} Source: ${item.source}.`;
  }
  if (item.evidence) {
    return item.evidence;
  }
  if (item.source) {
    return `Source: ${item.source}.`;
  }
  return undefined;
}

function buildRequestSentence(item: ExportSupplementItem): string {
  switch (item.kind) {
    case "missing_operation":
      return "Please add this operation or confirm why it is not required.";
    case "missing_verification":
      return "Please provide the verification, calibration, or documentation support for this item.";
    case "underwritten_operation":
      return "Please provide time support or documentation showing how this operation is being covered.";
    default:
      return "Please clarify the intended repair-path position and provide the supporting documentation for this item.";
  }
}

function formatCategoryLabel(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function lowercaseFirst(value: string): string {
  if (!value) return value;
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function compact(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value && value.trim()));
}

function joinHumanList(values: string[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
