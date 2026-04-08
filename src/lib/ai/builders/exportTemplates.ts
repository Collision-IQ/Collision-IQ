import {
  buildExportModel,
  buildPreferredRebuttalSubjectVehicleLabel,
  preferCanonicalField,
  resolveCanonicalVehicleLabel,
  type ExportModel,
  type ExportSupplementItem,
  type ResolvedExportInput,
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

export type ExportBuilderInput =
  | ResolvedExportInput
  | {
      report: RepairIntelligenceReport | null;
      analysis: AnalysisResult | null;
      panel: DecisionPanel | null;
      assistantAnalysis?: string | null;
      renderModel?: ExportModel | null;
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

export function buildExportTemplateSourceModel(params: ExportBuilderInput): ExportTemplateSourceModel {
  const exportModel = resolveExportModel(params);
  const analysisMode = params.analysis?.mode ?? params.report?.analysis?.mode ?? "single-document-review";
  const source: ExportTemplateSourceModel = {
    exportModel,
    analysisMode,
    generatedLabel: new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    categoryComparisons: buildCategoryComparisons(exportModel, analysisMode),
    lineItems: buildLineItems(exportModel, params.analysis, analysisMode),
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
      carrierPosition: describeCarrierPosition(item, analysisMode === "comparison"),
      supportStatus: mapSupportStatus(item.kind),
      rationale: item.rationale,
      support: buildSupportSnippet(item),
    }));
  }

  return source;
}

export function buildRebuttalEmailTemplate(params: ExportBuilderInput): string {
  const source = buildExportTemplateSourceModel(params);
  const { exportModel } = source;
  const subjectVehicle =
    preferCanonicalField(
      exportModel.reportFields.vehicleLabel,
      buildPreferredRebuttalSubjectVehicleLabel(exportModel.vehicle)
    ) ?? "Current repair file";
  const topItems = exportModel.supplementItems.slice(0, 4);
  const asks = topItems.length > 0
    ? topItems.map((item) => `- ${item.title}: ${buildRequestSentence(item)}`)
    : ["- Please review the current estimate support and provide any supporting documentation needed to confirm the intended scope."];

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

export function buildSideBySideComparisonReport(params: ExportBuilderInput): string {
  const source = buildExportTemplateSourceModel(params);
  const { exportModel } = source;
  const isComparison = source.analysisMode === "comparison";
  const vehicleIdentity = resolveCanonicalVehicleLabel(exportModel) ?? "Unspecified";

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

export function buildLineByLineComparisonReport(params: ExportBuilderInput): string {
  const source = buildExportTemplateSourceModel(params);
  const { exportModel } = source;
  const isComparison = source.analysisMode === "comparison";
  const vehicleIdentity = resolveCanonicalVehicleLabel(exportModel) ?? "Unspecified";

  const rows = source.lineItems.map((item, index) =>
    [
      `## Line ${index + 1}`,
      `Operation: ${item.operation}`,
      `Component: ${item.component}`,
      item.rawLine ? `Estimate line: ${item.rawLine}` : undefined,
      `${isComparison ? "Carrier position" : "Support posture"}: ${item.carrierPosition}`,
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
      : "This view focuses on estimate operations, what the file documents, and whether the current estimate support reads as documented, open, or still uncertain.",
    "",
    ...rows,
  ].join("\n");
}

function buildCategoryComparisons(
  exportModel: ExportModel,
  analysisMode: AnalysisResult["mode"] | "single-document-review"
): ExportCategoryComparison[] {
  const isComparison = analysisMode === "comparison";
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
      shopPosition: summarizeShopCategoryPosition(topItems, exportModel.repairPosition, isComparison),
      carrierPosition: summarizeCarrierCategoryPosition(topItems, isComparison),
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
  analysis: AnalysisResult | null,
  analysisMode: AnalysisResult["mode"] | "single-document-review"
): ExportLineComparison[] {
  const isComparison = analysisMode === "comparison";
  const supplementItems = exportModel.supplementItems;
  const operations = analysis?.operations ?? [];
  const matchedSupplementKeys = new Set<string>();

  const lines = operations.map((operation) => {
    const operationLabel = resolveOperationLabel(operation);
    const operationCategory = classifyEstimateOperation(operation);
    const match = findBestSupplementMatch(operation, supplementItems);
    if (match) {
      matchedSupplementKeys.add(normalizeKey(match.title));
    }

    return {
      operation: operationLabel,
      component: operation.component,
      rawLine: operation.rawLine,
      carrierPosition: match
        ? describeCarrierPosition(match, isComparison)
        : isComparison
          ? "No explicit carrier-side support issue was flagged for this operation in the current file review."
          : "No explicit estimate-support issue was flagged for this operation in the current file review.",
      supportStatus: match ? mapSupportStatus(match.kind) : "supported",
      rationale: match
        ? match.rationale
        : "This line is present in the estimate material and was not singled out as a major current support issue.",
      support: match ? buildSupportSnippet(match) : undefined,
    };
  });

  const unmatchedSupplements = supplementItems
    .filter((item) => !matchedSupplementKeys.has(normalizeKey(item.title)))
    .slice(0, Math.max(0, 10 - lines.length))
    .map((item) => ({
      operation: item.title,
      component: formatCategoryLabel(item.category),
      carrierPosition: describeCarrierPosition(item, isComparison),
      supportStatus: mapSupportStatus(item.kind),
      rationale: item.rationale,
      support: buildSupportSnippet(item),
    }));

  return [...lines, ...unmatchedSupplements];
}

function findBestSupplementMatch(
  operation: NonNullable<AnalysisResult["operations"]>[number],
  items: ExportSupplementItem[]
): ExportSupplementItem | undefined {
  const operationLabel = resolveOperationLabel(operation);
  const operationCategory = classifyEstimateOperation(operation);
  const operationTokens = tokenize(`${operationLabel} ${operation.component} ${operation.rawLine}`);
  let best: ExportSupplementItem | undefined;
  let bestScore = 0;

  for (const item of items) {
    const compatibility = scoreLineCompatibility(operation, operationCategory, operationTokens, item);
    if (compatibility > bestScore) {
      best = item;
      bestScore = compatibility;
    }
  }

  return bestScore >= 3 ? best : undefined;
}

function resolveOperationLabel(
  operation: NonNullable<AnalysisResult["operations"]>[number]
): string {
  const cleanedRaw = cleanOperationSourceText(operation.rawLine);
  const cleanedComponent = cleanOperationSourceText(operation.component);
  const normalizedOperation = normalizeKey(operation.operation);

  if (!cleanedRaw && !cleanedComponent) {
    return operation.operation;
  }

  if (normalizedOperation === "proc" || normalizedOperation === "procedure") {
    return cleanedRaw || cleanedComponent || operation.operation;
  }

  const cleanedOperation = cleanOperationSourceText(operation.operation);
  if (!cleanedOperation) {
    return cleanedRaw || cleanedComponent || operation.operation;
  }

  if (
    cleanedComponent &&
    normalizeKey(cleanedComponent) !== normalizeKey(cleanedOperation) &&
    normalizeKey(cleanedComponent).includes(normalizeKey(cleanedOperation))
  ) {
    return cleanedComponent;
  }

  return cleanedOperation;
}

function cleanOperationSourceText(value: string | undefined): string {
  if (!value) return "";

  const cleaned = value
    .replace(/^\s*#?\s*\d+\s+/i, "")
    .replace(/^\s*(?:proc|procedure|r&i|repl|rpr|blnd|subl|algn)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "";
  if (/^(?:proc|procedure)$/i.test(cleaned)) return "";
  return cleaned;
}

type LineOperationCategory =
  | "scan"
  | "test_fit"
  | "road_test"
  | "restraint"
  | "corrosion"
  | "alignment"
  | "calibration"
  | "refinish"
  | "structural"
  | "material"
  | "general";

function classifyEstimateOperation(
  operation: NonNullable<AnalysisResult["operations"]>[number]
): LineOperationCategory {
  const text = `${operation.operation} ${operation.component} ${operation.rawLine}`.toLowerCase();

  if (/(pre-?repair scan|pre scan|in-?process scan|in process scan|post-?repair scan|post scan|diagnostic scan)/i.test(text)) {
    return "scan";
  }
  if (/(pre-?paint test fit|test fit|fit check|mock-?up|fit verification)/i.test(text)) {
    return "test_fit";
  }
  if (/(final road test|road test|quality check)/i.test(text)) {
    return "road_test";
  }
  if (/(seat belt dynamic function test|seat belt|restraint)/i.test(text)) {
    return "restraint";
  }
  if (/(cavity wax|corrosion protection|anti-?corrosion|seam sealer|weld protection)/i.test(text)) {
    return "corrosion";
  }
  if (/(four wheel alignment|4 wheel alignment|wheel alignment|alignment)/i.test(text)) {
    return "alignment";
  }
  if (/(calibration|camera|radar|adas|sensor)/i.test(text)) {
    return "calibration";
  }
  if (/(mask|tint|polish|sand|refinish|blend)/i.test(text)) {
    return "refinish";
  }
  if (/(measure|measuring|dimension|structural|setup|pull|realign|rail|tie bar|support)/i.test(text)) {
    return "structural";
  }
  if (/(material|clip|seal|hardware)/i.test(text)) {
    return "material";
  }

  return "general";
}

function classifySupplementItem(item: ExportSupplementItem): LineOperationCategory {
  const text = `${item.title} ${item.category} ${item.rationale} ${item.evidence ?? ""}`.toLowerCase();

  if (/scan/.test(text)) return "scan";
  if (/pre-?paint test fit|test fit|fit check|mock-?up/.test(text)) return "test_fit";
  if (/road test|quality check/.test(text)) return "road_test";
  if (/seat belt|restraint/.test(text)) return "restraint";
  if (/cavity wax|corrosion|seam sealer|weld protection/.test(text)) return "corrosion";
  if (/alignment/.test(text)) return "alignment";
  if (/calibration|camera|radar|adas|sensor/.test(text)) return "calibration";
  if (/refinish|blend|mask|tint|polish|sand/.test(text)) return "refinish";
  if (/structural|measure|measuring|dimension|setup|pull|realign|rail|tie bar|support/.test(text)) {
    return "structural";
  }
  if (/hardware|seal|clip|material/.test(text)) return "material";

  return "general";
}

function scoreLineCompatibility(
  operation: NonNullable<AnalysisResult["operations"]>[number],
  operationCategory: LineOperationCategory,
  operationTokens: Set<string>,
  item: ExportSupplementItem
): number {
  const itemCategory = classifySupplementItem(item);
  if (!categoriesAreCompatible(operationCategory, itemCategory)) {
    return 0;
  }

  const haystack = `${item.title} ${item.rationale} ${item.evidence ?? ""}`;
  const haystackTokens = tokenize(haystack);
  const overlap = [...operationTokens].filter((token) => haystackTokens.has(token)).length;
  let score = overlap;

  if (normalizeKey(resolveOperationLabel(operation)) === normalizeKey(item.title)) {
    score += 5;
  }

  if (operationCategory === itemCategory && itemCategory !== "general") {
    score += 3;
  }

  if (
    operationCategory === "general" &&
    overlap < 2
  ) {
    return 0;
  }

  return score;
}

function categoriesAreCompatible(
  operationCategory: LineOperationCategory,
  itemCategory: LineOperationCategory
): boolean {
  if (operationCategory === "general" || itemCategory === "general") {
    return true;
  }

  if (operationCategory === itemCategory) {
    return true;
  }

  if (operationCategory === "scan") return itemCategory === "scan" || itemCategory === "calibration";
  if (operationCategory === "calibration") return itemCategory === "calibration" || itemCategory === "scan";
  if (operationCategory === "material") return itemCategory === "material" || itemCategory === "corrosion";
  if (operationCategory === "corrosion") return itemCategory === "corrosion" || itemCategory === "material";

  return false;
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
    "proc",
    "procedure",
    "final",
    "dynamic",
    "function",
    "test",
    "operation",
    "misc",
    "miscellaneous",
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
  repairPosition: string,
  isComparison: boolean
): string {
  if (items.length === 0) {
    return repairPosition;
  }

  if (!isComparison) {
    return `The estimate position supports ${joinHumanList(items.map((item) => item.title.toLowerCase()))}.`;
  }

  return `The shop-side repair path supports ${joinHumanList(items.map((item) => item.title.toLowerCase()))}.`;
}

function summarizeCarrierCategoryPosition(
  items: ExportSupplementItem[],
  isComparison: boolean
): string {
  if (items.length === 0) {
    return isComparison
      ? "No clear unsupported variance was identified in this category from the current file review."
      : "No clear estimate-support issue was identified in this category from the current file review.";
  }

  return items.map((item) => describeCarrierPosition(item, isComparison)).join(" ");
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

function describeCarrierPosition(item: ExportSupplementItem, isComparison = true): string {
  switch (item.kind) {
    case "missing_operation":
      return isComparison
        ? `${item.title} is not clearly carried in the current estimate posture.`
        : `${item.title} is not clearly carried in the current estimate support.`;
    case "missing_verification":
      return isComparison
        ? `${item.title} may be implicitly required, but the current verification or documentation is not clearly shown.`
        : `${item.title} may be relevant, but the current verification or documentation is not clearly shown.`;
    case "underwritten_operation":
      return isComparison
        ? `${item.title} appears lighter or under-supported in the current estimate.`
        : `${item.title} still needs clearer estimate support or documentation.`;
    default:
      return isComparison
        ? `${item.title} reflects a repair-path position that still needs clearer support in the current file.`
        : `${item.title} still needs clearer support in the current file.`;
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
  if (item.evidence) {
    return item.evidence;
  }
  if (item.source && !/^(?:estimate text|documentation)$/i.test(item.source)) {
    return `Document support: ${item.source}`;
  }
  return undefined;
}

function buildRequestSentence(item: ExportSupplementItem): string {
  switch (item.kind) {
    case "missing_operation":
      return "Please add this item or clarify why it is not required for the documented repair path.";
    case "missing_verification":
      return "Please provide the verification, calibration, or documentation support for this item.";
    case "underwritten_operation":
      return "Please provide the documentation showing how this item is supported in the current estimate.";
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

function resolveExportModel(params: ExportBuilderInput): ExportModel {
  if (params.renderModel) {
    return params.renderModel;
  }

  return buildExportModel({
    report: params.report,
    analysis: params.analysis,
    panel: params.panel,
    assistantAnalysis: params.assistantAnalysis,
  });
}
