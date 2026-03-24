import type { DecisionPanel } from "./buildDecisionPanel";
import { deriveRenderInsightsFromChat, type DerivedValuation } from "./deriveRenderInsightsFromChat";
import type { AnalysisResult, RepairIntelligenceReport } from "../types/analysis";

export const COLLISION_ACADEMY_HANDOFF_URL = "https://www.collision.academy/";

export type ExportSupplementItem = {
  title: string;
  category: string;
  kind:
    | "missing_operation"
    | "underwritten_operation"
    | "disputed_repair_path"
    | "missing_verification";
  rationale: string;
  evidence?: string;
  source?: string;
  priority: "low" | "medium" | "high";
};

export type ExportVehicleInfo = {
  label?: string;
  vin?: string;
  year?: number;
  make?: string;
  model?: string;
  confidence: "supported" | "partial" | "unknown";
};

export type ExportModel = {
  vehicle: ExportVehicleInfo;
  repairPosition: string;
  positionStatement: string;
  supplementItems: ExportSupplementItem[];
  request: string;
  valuation: DerivedValuation;
};

const KNOWN_MAKES = [
  "Acura",
  "Audi",
  "BMW",
  "Buick",
  "Cadillac",
  "Chevrolet",
  "Chrysler",
  "Dodge",
  "Ford",
  "GMC",
  "Honda",
  "Hyundai",
  "Infiniti",
  "Jeep",
  "Kia",
  "Lexus",
  "Lincoln",
  "Mazda",
  "Mercedes",
  "Mercedes-Benz",
  "Mini",
  "Mitsubishi",
  "Nissan",
  "Polestar",
  "Porsche",
  "Ram",
  "Subaru",
  "Tesla",
  "Toyota",
  "Volkswagen",
  "Volvo",
] as const;

const META_COMMENTARY_PATTERNS = [
  "repair strategy",
  "parts posture",
  "repair posture",
  "estimate posture",
  "estimate reviewed",
  "both estimates were reviewed",
  "it s mainly",
  "it's mainly",
  "mainly repair strategy",
  "missing access procedure items",
  "access/procedure items",
  "support gaps",
  "repair-path items",
  "repair path items",
] as const;

export function buildExportModel(params: {
  report: RepairIntelligenceReport | null;
  analysis: AnalysisResult | null;
  panel: DecisionPanel | null;
  assistantAnalysis?: string | null;
}): ExportModel {
  const chatInsights = deriveRenderInsightsFromChat(params.assistantAnalysis ?? "");
  const vehicle = inferVehicleInfo(
    params.report,
    params.analysis,
    params.assistantAnalysis ?? null
  );
  const supplementItems = buildExportSupplementItems(
    params.report,
    params.analysis,
    params.panel,
    chatInsights,
    params.assistantAnalysis ?? null
  );
  const repairPosition = buildRepairPosition(
    params.report,
    params.analysis,
    params.panel,
    chatInsights.narrative ?? params.assistantAnalysis ?? null,
    supplementItems
  );
  const positionStatement = buildPositionStatement(params.report, supplementItems);
  const request = buildRequest(params.report, params.panel, supplementItems, chatInsights.request);
  const valuation = buildValuation(params.panel, chatInsights.valuation);

  return {
    vehicle,
    repairPosition,
    positionStatement,
    supplementItems,
    request,
    valuation,
  };
}

function inferVehicleInfo(
  report: RepairIntelligenceReport | null,
  analysis: AnalysisResult | null,
  assistantAnalysis: string | null
): ExportVehicleInfo {
  const reportVehicle = report?.vehicle;
  const estimateText = collectVehicleInferenceText(report, analysis, assistantAnalysis);
  const structuredVehicle =
    reportVehicle && isSupportedVehicle(reportVehicle)
      ? {
          vin: normalizeVin(reportVehicle.vin),
          year: reportVehicle.year,
          make: cleanVehicleToken(reportVehicle.make),
          model: cleanVehicleToken(reportVehicle.model),
        }
      : null;
  const inferredVehicle = extractVehicleFromEstimateText(estimateText);
  const vehicle = structuredVehicle ?? inferredVehicle;
  const label = [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(" ").trim();
  const detailCount = [vehicle?.year, vehicle?.make, vehicle?.model, vehicle?.vin].filter(Boolean).length;

  return {
    label: label || undefined,
    vin: vehicle?.vin,
    year: vehicle?.year,
    make: vehicle?.make,
    model: vehicle?.model,
    confidence:
      detailCount >= 3 || Boolean(vehicle?.vin)
        ? "supported"
        : detailCount >= 2
          ? "partial"
          : "unknown",
  };
}

function collectVehicleInferenceText(
  report: RepairIntelligenceReport | null,
  analysis: AnalysisResult | null,
  assistantAnalysis: string | null
): string {
  return [
    assistantAnalysis,
    analysis?.rawEstimateText,
    report?.analysis?.rawEstimateText,
    report?.recommendedActions?.join("\n"),
    report?.evidence
      .map((entry) => `${entry.title ?? ""}\n${entry.snippet ?? ""}`)
      .join("\n"),
    analysis?.evidence
      ?.map((entry) => `${entry.source ?? ""}\n${entry.quote ?? ""}`)
      .join("\n"),
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join("\n\n");
}

function buildRepairPosition(
  report: RepairIntelligenceReport | null,
  analysis: AnalysisResult | null,
  panel: DecisionPanel | null,
  assistantAnalysis: string | null,
  supplementItems: ExportSupplementItem[]
): string {
  const candidates = [
    assistantAnalysis,
    analysis?.narrative,
    panel?.narrative,
    ...(
      report?.recommendedActions.filter((item) => !looksLikeEstimateNoise(item)) ?? []
    ),
  ]
    .map((value) => sanitizeNarrative(value))
    .filter((value): value is string => Boolean(value));

  const strongestNarrative = candidates
    .filter((value) => !looksLikeMetaCommentary(value))
    .sort((left, right) => scoreRepairNarrative(right) - scoreRepairNarrative(left))[0];

  if (supplementItems.length > 0) {
    const topItems = supplementItems.slice(0, 5);
    const topTitles = joinHumanList(topItems.map((item) => item.title.toLowerCase()));
    const carrierUnderwritten = topItems.some((item) => item.kind !== "disputed_repair_path");
    const lead = carrierUnderwritten
      ? "The shop estimate appears materially more complete, while the carrier estimate remains materially underwritten across several distinct repair-path areas."
      : "The repair path still contains supportable disputed items that are not resolved in the current carrier-facing documentation.";

    if (strongestNarrative) {
      return `${lead} The clearest remaining issues are ${topTitles}. ${trimTrailingPunctuation(
        strongestNarrative
      )}.`;
    }

    return `${lead} The clearest remaining issues are ${topTitles}.`;
  }

  const broaderNarrative = candidates.find((value) => {
    const lower = value.toLowerCase();
    return (
      (lower.includes("carrier estimate") || lower.includes("shop estimate")) &&
      (lower.includes("underwritten") || lower.includes("more complete") || lower.includes("repair path"))
    );
  });

  if (broaderNarrative) {
    return broaderNarrative;
  }

  return strongestNarrative ?? "No repair narrative was available from the current analysis.";
}

function buildPositionStatement(
  report: RepairIntelligenceReport | null,
  supplementItems: ExportSupplementItem[]
): string {
  const unsupportedItems = supplementItems.length;
  const criticalCount = report?.summary.criticalIssues ?? 0;

  if (criticalCount === 0 && unsupportedItems === 0) {
    return "The available analysis does not show a clear unsupported repair-process gap from the current material.";
  }

  if (supplementItems.length > 0) {
    const topItems = supplementItems.slice(0, 5);
    const topOperations = topItems.map((item) => item.title.toLowerCase());
    const kinds = new Set(topItems.map((item) => item.kind));
    const lead =
      kinds.has("missing_operation")
        ? "The current estimate still has meaningful missing or unsupported repair-process items across several distinct repair-path areas."
        : kinds.has("missing_verification")
          ? "The current estimate still has meaningful verification and documentation gaps across several distinct repair-path areas."
        : kinds.has("underwritten_operation")
          ? "The current estimate still shows meaningful underwritten repair-process items across several distinct repair-path areas."
          : "The current estimate still shows meaningful disputed repair-path items across several distinct repair-path areas.";

    return `${lead} The strongest concerns are ${joinHumanList(topOperations)}.`;
  }

  return "The current estimate does not yet read as fully supported because key procedures or documentation remain unclear.";
}

function buildRequest(
  report: RepairIntelligenceReport | null,
  panel: DecisionPanel | null,
  supplementItems: ExportSupplementItem[],
  chatRequest?: string
): string {
  if (supplementItems.length > 0) {
    const heading = buildRequestHeading(supplementItems);
    return [
      heading,
      ...supplementItems.slice(0, 6).map((item) => {
        return `- ${item.title}: ${buildRequestLine(item)}`;
      }),
    ].join("\n");
  }

  if (chatRequest?.trim() && looksLikeCleanRequest(chatRequest)) {
    return sanitizeReason(chatRequest, "Please review and advise how the repair process is being documented and supported.");
  }

  if (
    panel?.negotiationResponse?.trim() &&
    !isContradictorySupportiveDraft(panel.negotiationResponse, report, supplementItems)
  ) {
    return sanitizeReason(panel.negotiationResponse, panel.negotiationResponse.trim());
  }

  const topIssues =
    report?.issues
      .filter((issue) => issue.severity === "high" || issue.missingOperation)
      .slice(0, 3)
      .map((issue) => `- ${issue.title}: ${issue.impact || issue.finding}`) ?? [];

  if (topIssues.length > 0) {
    return [
      "Please review the following items and provide updated support if they are included:",
      ...topIssues,
    ].join("\n");
  }

  return "Please review and advise how the repair process is being documented and supported.";
}

function buildExportSupplementItems(
  report: RepairIntelligenceReport | null,
  analysis: AnalysisResult | null,
  panel: DecisionPanel | null,
  chatInsights: ReturnType<typeof deriveRenderInsightsFromChat>,
  assistantAnalysis: string | null
): ExportSupplementItem[] {
  const fromPanel: ExportSupplementItem[] =
    panel?.supplements
      .filter((item) => isSpecificSupplementItem(item.title) || isSpecificSupplementItem(item.mappedLabel))
      .map((item) => ({
      title: item.mappedLabel || item.title,
      category: item.category,
      kind: inferSupplementKindFromText(item.rationale),
      rationale: sanitizeReason(
        item.rationale,
        "This operation appears underwritten or not fully supported in the current estimate."
      ),
      evidence: item.support,
      source: "Decision panel",
      priority: "medium",
    })) ?? [];

  const fromMissingProcedures: ExportSupplementItem[] =
    report?.missingProcedures.map((procedure) => ({
      title: deriveSupplementTitle(procedure),
      category: inferSupplementCategory(procedure),
      kind: "missing_operation",
      rationale: "This function is not clearly represented in the current estimate.",
      source: "Missing procedure list",
      priority: "medium",
    })) ?? [];

  const fromSupplementOpportunities: ExportSupplementItem[] =
    report?.supplementOpportunities
      .map((item) => ({
        raw: item,
        title: deriveSupplementTitle(item),
      }))
      .filter((item) => isSpecificSupplementItem(item.title))
      .map((item) => ({
      title: item.title,
      category: inferSupplementCategory(item.title),
      kind: inferSupplementKindFromText(item.raw),
      rationale: sanitizeReason(
        item.raw,
        "This supplement opportunity was identified during structured analysis."
      ),
      source: "Supplement opportunity",
      priority: "medium",
    })) ?? [];

  const fromIssues: ExportSupplementItem[] =
    report?.issues
      .map((issue) => buildSupplementItemFromIssue(report, issue))
      .filter((item): item is ExportSupplementItem => Boolean(item)) ?? [];

  const fromAnalysisFindings: ExportSupplementItem[] =
    paramsToAnalysisFindings(report, panel)
      .map((item) => ({
        ...item,
        title: deriveSupplementTitle(item.title),
      }))
      .filter((item) => isSpecificSupplementItem(item.title))
      .map((item) => ({
        title: item.title,
        category: inferSupplementCategory(item.title),
        kind: inferSupplementKindFromText(item.reason),
        rationale: sanitizeReason(
          item.reason,
          "This operation appears underwritten or not fully supported in the current estimate."
        ),
        evidence: item.evidence,
        source: item.source,
        priority: item.priority,
      }));

  const fromChatInsights: ExportSupplementItem[] = chatInsights.supplementItems
    .map((item) => ({
      ...item,
      title: deriveSupplementTitle(item.title || item.rationale),
      rationale: sanitizeReason(
        item.rationale,
        "This operation appears underwritten or not fully supported in the current estimate."
      ),
    }))
    .filter((item) => isSpecificSupplementItem(item.title));

  const merged = [
    ...fromPanel,
    ...fromMissingProcedures,
    ...fromSupplementOpportunities,
    ...fromIssues,
    ...fromAnalysisFindings,
    ...fromChatInsights,
  ];
  const deduped = new Map<string, ExportSupplementItem>();

  for (const item of merged) {
    const key = normalizeKey(item.title);
    if (!key) continue;

    if (!deduped.has(key)) {
      deduped.set(key, item);
      continue;
    }

    const existing = deduped.get(key)!;
    deduped.set(key, {
      ...existing,
      rationale:
        pickBetterNarrative(existing.rationale, item.rationale) ?? existing.rationale,
      evidence: pickPreferredDetail(existing.evidence, item.evidence),
      source: pickPreferredDetail(existing.source, item.source),
      kind: mergeSupplementKind(existing.kind, item.kind),
      priority: mergePriority(existing.priority, item.priority),
    });
  }

  const resolved = [...deduped.values()].sort(sortSupplementItems);
  if (resolved.length > 0) {
    return resolved;
  }

  return synthesizeSupplementItemsFromNarrative({
    assistantAnalysis,
    analysisNarrative: analysis?.narrative ?? null,
    panelNarrative: panel?.narrative ?? null,
    recommendedActions: report?.recommendedActions ?? [],
  });
}

function buildValuation(
  panel: DecisionPanel | null,
  chatValuation: DerivedValuation
): DerivedValuation {
  const sanePanelDv = coerceSaneDvRange(panel?.diminishedValue?.low, panel?.diminishedValue?.high);
  const hasChatDv =
    (chatValuation.dvStatus === "provided" && typeof chatValuation.dvValue === "number") ||
    (chatValuation.dvStatus === "estimated_range" && isSaneRange(chatValuation.dvRange, 50000));

  const dvStatus = hasChatDv
    ? chatValuation.dvStatus
    : sanePanelDv
      ? "estimated_range"
      : "not_determinable";

  return {
    ...chatValuation,
    acvStatus: normalizeAcvStatus(chatValuation),
    acvValue:
      chatValuation.acvStatus === "provided" && typeof chatValuation.acvValue === "number"
        ? chatValuation.acvValue
        : undefined,
    acvRange: isSaneRange(chatValuation.acvRange, 250000) ? chatValuation.acvRange : undefined,
    acvConfidence: normalizeValuationConfidence(
      normalizeAcvStatus(chatValuation),
      chatValuation.acvConfidence,
      chatValuation.acvMissingInputs
    ),
    acvReasoning:
      sanitizeReason(chatValuation.acvReasoning, "ACV is not determinable from the current documents.") ||
      "ACV is not determinable from the current documents.",
    acvMissingInputs:
      normalizeAcvStatus(chatValuation) === "not_determinable"
        ? (chatValuation.acvMissingInputs.length
            ? chatValuation.acvMissingInputs
            : ["vehicle condition", "mileage", "trim/options", "market comparable data"])
        : [],
    dvStatus,
    dvValue:
      hasChatDv && chatValuation.dvStatus === "provided" ? chatValuation.dvValue : undefined,
    dvRange:
      hasChatDv && chatValuation.dvStatus === "estimated_range"
        ? chatValuation.dvRange
        : sanePanelDv,
    dvConfidence: normalizeValuationConfidence(
      dvStatus,
      chatValuation.dvConfidence ?? normalizePanelDvConfidence(panel?.diminishedValue?.confidence),
      chatValuation.dvMissingInputs
    ),
    dvReasoning:
      sanitizeReason(
        hasChatDv ? chatValuation.dvReasoning : panel?.diminishedValue?.rationale,
        "DV is not determinable from the current documents."
      ) || "DV is not determinable from the current documents.",
    dvMissingInputs:
      dvStatus === "not_determinable"
        ? (chatValuation.dvMissingInputs.length
            ? chatValuation.dvMissingInputs
            : ["repair severity context", "damage photos or confirmed repair scope", "pre-loss market context"])
        : [],
  };
}

function normalizePanelDvConfidence(
  confidence?: "low" | "medium" | "high" | "low_to_moderate"
): "low" | "medium" | "high" | undefined {
  if (!confidence) return undefined;
  if (confidence === "low_to_moderate") return "low";
  return confidence;
}

function normalizeValuationConfidence(
  status: "provided" | "estimated_range" | "not_determinable",
  confidence?: "low" | "medium" | "high",
  missingInputs: string[] = []
): "low" | "medium" | "high" | undefined {
  if (status === "not_determinable") {
    return missingInputs.length > 0 ? "low" : confidence;
  }

  if (confidence) {
    if (missingInputs.length > 0 && confidence === "high") return "medium";
    return confidence;
  }

  if (status === "estimated_range") {
    return missingInputs.length > 0 ? "low" : "medium";
  }

  return missingInputs.length > 0 ? "medium" : "high";
}

function inferSupplementCategory(value: string): string {
  const lower = value.toLowerCase();

  if (lower.includes("scan")) return "scan";
  if (lower.includes("calibration") || lower.includes("radar") || lower.includes("camera")) {
    return "calibration";
  }
  if (
    lower.includes("seam") ||
    lower.includes("corrosion") ||
    lower.includes("primer") ||
    lower.includes("wax") ||
    lower.includes("protection")
  ) {
    return "material";
  }
  if (
    lower.includes("frame") ||
    lower.includes("setup") ||
    lower.includes("realignment") ||
    lower.includes("structural") ||
    lower.includes("section") ||
    lower.includes("measure") ||
    lower.includes("support area") ||
    lower.includes("upper rail") ||
    lower.includes("lock support") ||
    lower.includes("tie bar") ||
    lower.includes("core support")
  ) {
    return "structural";
  }

  return "labor";
}

function buildSupplementItemFromIssue(
  report: RepairIntelligenceReport | null,
  issue: RepairIntelligenceReport["issues"][number]
): ExportSupplementItem | null {
  const title = deriveSupplementTitle(
    issue.missingOperation || issue.title || issue.impact || issue.finding
  );
  if (!isSpecificSupplementItem(title)) {
    return null;
  }

  return {
    title,
    category: inferSupplementCategory(title),
    kind: inferSupplementKindFromText(
      `${issue.missingOperation ?? ""} ${issue.impact ?? ""} ${issue.finding ?? ""} ${issue.title ?? ""}`
    ),
    rationale: sanitizeSupplementReason(
      title,
      issue.impact || issue.finding,
      "This operation appears underwritten or not fully supported in the current estimate."
    ),
    evidence: buildIssueEvidence(report, issue.evidenceIds, title),
    source: issue.title,
    priority: issue.severity,
  };
}

function deriveSupplementTitle(value: string): string {
  const lower = value.toLowerCase();

  if (lower.includes("front structure scope")) {
    return "Front Structure Scope / Tie Bar / Upper Rail Reconciliation";
  }
  if (lower.includes("structural setup and pull verification")) {
    return "Structural Setup and Pull Verification";
  }
  if (lower.includes("structural measurement verification")) {
    return "Structural Measurement Verification";
  }
  if (lower.includes("adas / calibration procedure support")) {
    return "ADAS / Calibration Procedure Support";
  }
  if (lower.includes("oem fit-sensitive part posture")) {
    return "OEM Fit-Sensitive Part Posture";
  }
  if (lower.includes("upper tie bar / lock support reconciliation")) {
    return "Upper Tie Bar / Lock Support Reconciliation";
  }
  if (lower.includes("upper tie bar / core support reconciliation")) {
    return "Upper Tie Bar / Core Support Reconciliation";
  }
  if (lower.includes("post-repair scan") || lower.includes("post repair scan")) {
    return "Post-Repair Scan";
  }
  if (lower.includes("pre-repair scan") || lower.includes("pre repair scan")) {
    return "Pre-Repair Scan";
  }
  if (lower.includes("steering angle")) {
    return "Steering Angle Sensor Calibration";
  }
  if (lower.includes("fit-sensitive") || lower.includes("fit sensitive")) {
    return "OEM Fit-Sensitive Part Posture";
  }
  if (lower.includes("fender") && (lower.includes("replace") || lower.includes("repair"))) {
    return "Fender Replace vs Repair Justification";
  }
  if ((lower.includes("bumper") || lower.includes("lamp") || lower.includes("fender")) && lower.includes("test fit")) {
    return "Pre-Paint Test Fit";
  }
  if (lower.includes("bumper") && lower.includes("test fit")) {
    return "Bumper Test Fit";
  }
  if (lower.includes("lamp") && lower.includes("test fit")) {
    return "Lamp Test Fit";
  }
  if (lower.includes("fender") && lower.includes("test fit")) {
    return "Fender Test Fit";
  }
  if (lower.includes("camera")) {
    return "Camera Calibration";
  }
  if (lower.includes("radar")) {
    return "Radar Calibration";
  }
  if (lower.includes("scan")) {
    return lower.includes("post")
      ? "Post-Repair Scan"
      : lower.includes("pre")
        ? "Pre-Repair Scan"
        : "Diagnostic Scan";
  }
  if (lower.includes("alignment")) {
    return "Four-Wheel Alignment";
  }
  if (lower.includes("setup")) {
    return "Structural Setup and Pull Verification";
  }
  if (lower.includes("test fit") || lower.includes("mock-up") || lower.includes("mock up")) {
    return "Test Fit / Mock-Up";
  }
  if (lower.includes("coolant") || lower.includes("bleed") || lower.includes("purge")) {
    return "Coolant Fill and Bleed";
  }
  if (lower.includes("corrosion protection")) {
    return "Corrosion Protection / Cavity Wax";
  }
  if (lower.includes("cavity wax")) {
    return "Corrosion Protection / Cavity Wax";
  }
  if (lower.includes("seam sealer")) {
    return "Seam Sealer Restoration";
  }
  if (lower.includes("tie bar") || lower.includes("core support")) {
    return "Upper Tie Bar / Core Support Reconciliation";
  }
  if (lower.includes("lock support")) {
    return "Upper Tie Bar / Lock Support Reconciliation";
  }
  if (lower.includes("measure") || lower.includes("measurement") || lower.includes("structural")) {
    return "Structural Measurement Verification";
  }
  if (lower.includes("weld")) {
    return "Weld Verification";
  }
  if (lower.includes("airbag") || lower.includes("srs")) {
    return "SRS / Airbag System Verification";
  }
  if (lower.includes("seat belt") || lower.includes("pretensioner")) {
    return "Seat Belt / Pretensioner Verification";
  }

  return value.replace(/\s+/g, " ").trim();
}

function sanitizeReason(value?: string | null, fallback?: string): string {
  const cleaned = sanitizeNarrative(value) ?? "";
  if (!cleaned) return fallback ?? "";

  const withoutEstimateGlossary = cleaned
    .replace(/\bshould clearl\b/gi, "should clearly")
    .replace(/\bclearl\b/gi, "clearly")
    .replace(/\b(R&I|RPR|REPL|BLND|REFN|CAL|SCAN)\b(?:\s+\b(R&I|RPR|REPL|BLND|REFN|CAL|SCAN)\b)+/gi, "")
    .replace(/\s+[/:|-]\s*$/g, "")
    .replace(/[:;,\-]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return withoutEstimateGlossary || fallback || "";
}

function sanitizeSupplementReason(
  title: string,
  value?: string | null,
  fallback?: string
): string {
  const cleaned = sanitizeReason(value, fallback);

  if (title === "Seam Sealer Restoration") {
    const withoutRefinishGlossary = cleaned
      .replace(/\bcolor coat application\b/gi, "")
      .replace(/\bbagging\b/gi, "")
      .replace(/\bthree-stage finishes?\b/gi, "")
      .replace(/\bcolor blend\b/gi, "")
      .replace(/\bblend(?:ing)?\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .replace(/(?:,\s*){2,}/g, ", ")
      .replace(/^[,;:\s-]+|[,;:\s-]+$/g, "")
      .trim();

    return (
      withoutRefinishGlossary ||
      "Please provide the seam sealer restoration steps and supporting repair-process documentation for the affected repaired or replaced areas."
    );
  }

  return cleaned;
}

function pickPreferredDetail(left?: string, right?: string): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return right.length > left.length ? right : left;
}

function pickBetterNarrative(left?: string, right?: string): string | undefined {
  const candidates = [left, right].filter(Boolean) as string[];
  if (candidates.length === 0) return undefined;
  return candidates.sort((a, b) => scoreNarrative(b) - scoreNarrative(a))[0];
}

function scoreNarrative(value: string): number {
  const lower = value.toLowerCase();
  let score = value.length;
  if (lower.includes("not clearly")) score += 50;
  if (lower.includes("not documented")) score += 50;
  if (lower.includes("underwritten")) score += 50;
  if (lower.includes("requires")) score += 25;
  return score;
}

function sortSupplementItems(
  left: ExportSupplementItem,
  right: ExportSupplementItem
): number {
  const scoreDelta = scoreSupplementItem(right) - scoreSupplementItem(left);
  if (scoreDelta !== 0) return scoreDelta;
  return left.title.localeCompare(right.title);
}

function scoreSupplementItem(item: ExportSupplementItem): number {
  const lower = `${item.title} ${item.rationale} ${item.source ?? ""}`.toLowerCase();
  let score = item.priority === "high" ? 300 : item.priority === "medium" ? 200 : 100;
  if (item.kind === "missing_operation") score += 45;
  if (item.kind === "underwritten_operation") score += 35;
  if (item.kind === "disputed_repair_path") score += 30;
  if (item.category === "structural") score += 140;
  if (item.category === "material") score += 80;
  if (
    lower.includes("front structure") ||
    lower.includes("tie bar") ||
    lower.includes("lock support") ||
    lower.includes("support area") ||
    lower.includes("upper rail") ||
    lower.includes("core support")
  ) score += 125;
  if (lower.includes("setup") || lower.includes("measure") || lower.includes("realignment")) score += 110;
  if (lower.includes("replace vs repair") || lower.includes("repair vs replace")) score += 105;
  if (lower.includes("fit-sensitive") || lower.includes("fit sensitive")) score += 100;
  if (lower.includes("adas") || lower.includes("calibration procedure support")) score += 95;
  if (lower.includes("test fit")) score += 100;
  if (lower.includes("coolant") || lower.includes("bleed") || lower.includes("refill")) score += 95;
  if (lower.includes("corrosion") || lower.includes("cavity wax") || lower.includes("seam sealer") || lower.includes("weld protection")) score += 90;
  if (lower.includes("alignment")) score += 85;
  if (lower.includes("scan") || lower.includes("calibration")) score += 50;
  if (looksLikeMetaCommentary(lower)) score -= 400;
  if (lower.includes("not documented") || lower.includes("not clearly") || lower.includes("underwritten")) score += 40;
  score += Math.min(item.rationale.length, 100);
  return score;
}

function buildRequestHeading(items: ExportSupplementItem[]): string {
  const kinds = new Set(items.map((item) => item.kind));
  if (kinds.has("missing_operation")) {
    return "Please review and document support for the following operations if they are part of the intended repair plan:";
  }
  if (kinds.has("missing_verification")) {
    return "Please review the following verification and documentation items and provide the supporting procedure path, measurements, scans, calibrations, or related records:";
  }
  if (kinds.has("underwritten_operation")) {
    return "Please review the following underwritten operations and provide support, time justification, or related documentation:";
  }
  return "Please review the following disputed repair-path items and provide the supporting rationale or documentation for the intended approach:";
}

function looksLikeCleanRequest(value: string): boolean {
  const lower = value.toLowerCase();
  if (looksLikeEstimateNoise(value)) return false;
  if (
    lower.includes("narrows repair scope") ||
    lower.includes("restructured rather than simply shortened") ||
    lower.includes("carrier estimate appears")
  ) {
    return false;
  }
  return lower.startsWith("please review") || lower.startsWith("please provide");
}

function joinHumanList(values: string[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function scoreRepairNarrative(value: string): number {
  const lower = value.toLowerCase();
  let score = value.length;
  if (lower.includes("shop estimate")) score += 80;
  if (lower.includes("carrier estimate")) score += 80;
  if (lower.includes("underwritten")) score += 70;
  if (lower.includes("more complete")) score += 60;
  if (lower.includes("repair path")) score += 40;
  if (lower.includes("materially")) score += 25;
  if (looksLikeMetaCommentary(lower)) score -= 100;
  return score;
}

function trimTrailingPunctuation(value: string): string {
  return value.replace(/[.!\s]+$/g, "").trim();
}

function looksLikeMetaCommentary(value: string): boolean {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return true;

  if (
    META_COMMENTARY_PATTERNS.some((pattern) =>
      normalized.includes(pattern.replace(/[^a-z0-9\s]/g, " "))
    )
  ) {
    return true;
  }

  return (
    !normalized.includes("test fit") &&
    !normalized.includes("alignment") &&
    !normalized.includes("scan") &&
    !normalized.includes("calibration") &&
    !normalized.includes("coolant") &&
    !normalized.includes("tie bar") &&
    !normalized.includes("lock support") &&
    !normalized.includes("core support") &&
    !normalized.includes("cavity wax") &&
    !normalized.includes("corrosion") &&
    !normalized.includes("fender") &&
    !normalized.includes("bumper") &&
    !normalized.includes("lamp") &&
    normalized.includes("repair strategy")
  );
}

function inferSupplementKindFromText(
  value?: string | null
): ExportSupplementItem["kind"] {
  const lower = (value ?? "").toLowerCase();
  if (
    lower.includes("verification") ||
    lower.includes("documented measurements") ||
    lower.includes("procedure support") ||
    lower.includes("calibration") ||
    lower.includes("scan") ||
    lower.includes("alignment")
  ) {
    return "missing_verification";
  }
  if (
    lower.includes("missing") ||
    lower.includes("omitted") ||
    lower.includes("not shown") ||
    lower.includes("not carried") ||
    lower.includes("not reflected")
  ) {
    return "missing_operation";
  }
  if (
    lower.includes("underwritten") ||
    lower.includes("not documented") ||
    lower.includes("not clearly represented") ||
    lower.includes("not clearly supported") ||
    lower.includes("needs documentation") ||
    lower.includes("time justification") ||
    lower.includes("access burden")
  ) {
    return "underwritten_operation";
  }
  return "disputed_repair_path";
}

function mergeSupplementKind(
  left: ExportSupplementItem["kind"],
  right: ExportSupplementItem["kind"]
): ExportSupplementItem["kind"] {
  const rank = {
    missing_operation: 3,
    missing_verification: 2,
    underwritten_operation: 2,
    disputed_repair_path: 1,
  };
  return rank[left] >= rank[right] ? left : right;
}

function buildRequestLine(item: ExportSupplementItem): string {
  const reason = sanitizeReason(item.rationale, "Please clarify how this item is being supported.");

  switch (item.title) {
    case "Structural Measurement Verification":
      return "Please provide the documented measurement or realignment support for this repair path, including how structural verification was performed.";
    case "Structural Setup and Pull Verification":
      return "Please provide the setup, pull, or realignment rationale and the time support for that structural burden.";
    case "Fender Replace vs Repair Justification":
      return "Please provide the replace-versus-repair rationale for the fender, including how mounting alignment, wheel-opening shape, or adjacent support damage were evaluated.";
    case "OEM Fit-Sensitive Part Posture":
      return "Please provide the OEM-versus-aftermarket rationale for this fit-sensitive area, including any gap, finish, or stack-up concerns affecting the part posture.";
    case "Front Structure Scope / Tie Bar / Upper Rail Reconciliation":
      return "Please provide the rationale and scope support for the front structure, tie bar, support-area, or upper-rail reconciliation reflected by the intended repair path.";
    case "Upper Tie Bar / Lock Support Reconciliation":
      return "Please provide the structural rationale and documentation supporting the upper tie bar or lock-support reconciliation.";
    case "ADAS / Calibration Procedure Support":
      return "Please provide the required ADAS, scan, and calibration procedure support for this repair path, including the expected verification steps.";
    case "Four-Wheel Alignment":
      return "Please provide the alignment rationale and any related post-repair documentation supporting this operation.";
    case "Pre-Paint Test Fit":
      return "Please provide the rationale for the pre-paint test fit burden and how final fit was to be confirmed before finish work.";
    case "Seam Sealer Restoration":
      return "Please provide the seam sealer restoration steps, affected areas, and supporting repair-process or OEM documentation for that sealing operation.";
    case "Corrosion Protection / Weld Restoration":
      return "Please provide the corrosion-protection, cavity-wax, seam, or weld-restoration documentation supporting this repair path.";
    case "Coolant Fill and Bleed":
      return "Please provide the support for the coolant refill, bleed, or related access burden associated with this repair path.";
    default:
      return reason;
  }
}

function synthesizeSupplementItemsFromNarrative(params: {
  assistantAnalysis: string | null;
  analysisNarrative: string | null;
  panelNarrative: string | null;
  recommendedActions: string[];
}): ExportSupplementItem[] {
  const text = [
    params.assistantAnalysis,
    params.analysisNarrative,
    params.panelNarrative,
    ...params.recommendedActions,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  if (!text.trim()) return [];

  const candidates: ExportSupplementItem[] = [];
  const add = (
    title: string,
    rationale: string,
    priority: ExportSupplementItem["priority"] = "medium",
    kind: ExportSupplementItem["kind"] = "underwritten_operation"
  ) => {
    if (!isSpecificSupplementItem(title)) return;
    candidates.push({
      title,
      category: inferSupplementCategory(title),
      kind,
      rationale,
      source: "Narrative fallback",
      priority,
    });
  };

  if (text.includes("pre scan") || text.includes("pre-scan") || text.includes("post scan") || text.includes("post-scan")) {
    if (text.includes("pre scan") || text.includes("pre-scan")) {
      add(
        "Pre-Repair Scan",
        "Pre-repair scan support is referenced in the repair reasoning, but the current structured output is not carrying that verification item clearly.",
        "medium",
        "missing_verification"
      );
    }
    if (text.includes("post scan") || text.includes("post-scan")) {
      add(
        "Post-Repair Scan",
        "Post-repair scan support is referenced in the repair reasoning, but the current structured output is not carrying that verification item clearly.",
        "medium",
        "missing_verification"
      );
    }
  }

  if (text.includes("test fit") || text.includes("fit-check") || text.includes("fit check")) {
    add(
      "Pre-Paint Test Fit",
      "The repair reasoning supports test-fit or fit-check burden for bumper, headlamp, fender, or adjacent panels before final finish work.",
      "high",
      "underwritten_operation"
    );
  }

  if (text.includes("frame bench") || text.includes("setup") || text.includes("measuring") || text.includes("realignment")) {
    add(
      "Structural Setup and Pull Verification",
      "Frame bench setup, measuring, or realignment burden is described in the repair reasoning but is not being preserved cleanly in the structured output.",
      "high",
      "underwritten_operation"
    );
    add(
      "Structural Measurement Verification",
      "The repair reasoning supports documented measurements or structural verification, but that verification item is not being carried cleanly into the export.",
      "high",
      "missing_verification"
    );
  }

  if (
    text.includes("tie bar") ||
    text.includes("lock support") ||
    text.includes("radiator support") ||
    text.includes("support area") ||
    text.includes("upper rail")
  ) {
    add(
      "Front Structure Scope / Tie Bar / Upper Rail Reconciliation",
      "The repair reasoning supports front-structure, tie-bar, lock-support, radiator-support, or support-area reconciliation that is not being preserved as a structured dispute item.",
      "high",
      "disputed_repair_path"
    );
  }

  if (text.includes("corrosion protection") || text.includes("cavity wax") || text.includes("weld protection") || text.includes("masking")) {
    add(
      "Corrosion Protection / Weld Restoration",
      "Corrosion protection, cavity wax, weld protection, or related masking/restoration steps are described in the repair reasoning but are not being preserved cleanly in the structured output.",
      "medium",
      "underwritten_operation"
    );
  }

  if (text.includes("refrigerant")) {
    add(
      "Refrigerant Recover / Recharge",
      "Refrigerant handling appears supportable in the repair reasoning, but that process burden is not being carried cleanly into the structured supplement output.",
      "medium",
      "underwritten_operation"
    );
  }

  if (text.includes("coolant") || text.includes("air purge") || text.includes("bleed")) {
    add(
      "Coolant Fill and Bleed",
      "Coolant refill, bleed, or air-purge burden is described in the repair reasoning, but that operation is not being preserved cleanly in the structured output.",
      "medium",
      "underwritten_operation"
    );
  }

  if (text.includes("battery disconnect") || text.includes("battery reset") || text.includes("reset considerations")) {
    add(
      "Battery Disconnect / Reset Considerations",
      "Battery disconnect or reset considerations are described in the repair reasoning, but that verification/process item is not being preserved cleanly in the structured output.",
      "medium",
      "missing_verification"
    );
  }

  if (text.includes("alignment")) {
    add(
      "Four-Wheel Alignment",
      "Alignment is described in the repair reasoning, but the current structured output is not carrying that support or verification item clearly.",
      "medium",
      "missing_verification"
    );
  }

  return candidates
    .filter((item, index, all) => all.findIndex((entry) => normalizeKey(entry.title) === normalizeKey(item.title)) === index)
    .sort(sortSupplementItems);
}

function normalizeAcvStatus(valuation: DerivedValuation): DerivedValuation["acvStatus"] {
  if (valuation.acvStatus === "provided" && typeof valuation.acvValue === "number") {
    return "provided";
  }
  if (valuation.acvStatus === "estimated_range" && isSaneRange(valuation.acvRange, 250000)) {
    return "estimated_range";
  }
  return "not_determinable";
}

function coerceSaneDvRange(
  low?: number,
  high?: number
): { low: number; high: number } | undefined {
  if (typeof low !== "number" || typeof high !== "number") return undefined;
  const range = { low, high };
  return isSaneRange(range, 50000) ? range : undefined;
}

function isSaneRange(
  range: { low: number; high: number } | undefined,
  max: number
): range is { low: number; high: number } {
  if (!range) return false;
  if (!Number.isFinite(range.low) || !Number.isFinite(range.high)) return false;
  if (range.low <= 0 || range.high <= 0) return false;
  if (range.high < range.low) return false;
  if (range.high > max) return false;
  if (range.high / range.low > 10) return false;
  return true;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractVehicleFromEstimateText(text: string): {
  vin?: string;
  year?: number;
  make?: string;
  model?: string;
} | null {
  if (!text.trim()) return null;

  const normalized = text.replace(/\r/g, "");
  const vin =
    normalizeVin(extractLabeledValue(normalized, ["vin", "vehicle identification number"])) ??
    normalizeVin(normalized.match(/\b[A-HJ-NPR-Z0-9]{17}\b/)?.[0]);

  const vehicleLine =
    extractLabeledValue(normalized, ["vehicle", "vehicle info", "vehicle information"]) ??
    extractVehicleLikeLine(normalized);
  const parsedVehicleLine = vehicleLine ? parseVehicleLine(vehicleLine) : null;

  const year =
    parsedVehicleLine?.year ??
    normalizeYear(extractLabeledValue(normalized, ["year"]));
  const make =
    parsedVehicleLine?.make ??
    cleanVehicleToken(extractLabeledValue(normalized, ["make"]));
  const model =
    parsedVehicleLine?.model ??
    cleanVehicleToken(extractLabeledValue(normalized, ["model"]));

  const supportedCount = [year, make, model, vin].filter(Boolean).length;
  if (supportedCount < 2 && !vin) {
    return null;
  }

  return { vin, year, make, model };
}

function extractLabeledValue(text: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const regex = new RegExp(`(?:^|\\n)\\s*${escapeRegExp(label)}\\s*[:#-]\\s*([^\\n]+)`, "i");
    const match = text.match(regex);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return undefined;
}

function extractVehicleLikeLine(text: string): string | undefined {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.find((line) =>
    /\b(19\d{2}|20\d{2})\b/.test(line) &&
    KNOWN_MAKES.some((make) => line.toLowerCase().includes(make.toLowerCase()))
  );
}

function parseVehicleLine(line: string): {
  year?: number;
  make?: string;
  model?: string;
} | null {
  const yearMatch = line.match(/\b(19\d{2}|20\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : undefined;
  const make = KNOWN_MAKES.find((candidate) =>
    line.toLowerCase().includes(candidate.toLowerCase())
  );

  if (!year && !make) {
    return null;
  }

  let model: string | undefined;
  if (make) {
    const regex = new RegExp(`${escapeRegExp(make)}\\s+([A-Za-z0-9-]{1,20}(?:\\s+[A-Za-z0-9-]{1,20})?)`, "i");
    model = line.match(regex)?.[1]?.trim();
  }

  return {
    year,
    make,
    model,
  };
}

function normalizeVin(value?: string): string | undefined {
  if (!value) return undefined;
  const candidate = value.toUpperCase().match(/[A-HJ-NPR-Z0-9]{17}/)?.[0];
  return candidate;
}

function normalizeYear(value?: string): number | undefined {
  if (!value) return undefined;
  const match = value.match(/\b(19\d{2}|20\d{2})\b/);
  if (!match) return undefined;
  const year = Number(match[1]);
  return year >= 1980 && year <= 2035 ? year : undefined;
}

function cleanVehicleToken(value?: string): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned || undefined;
}

function isSupportedVehicle(vehicle: RepairIntelligenceReport["vehicle"]): boolean {
  if (!vehicle) return false;
  return Boolean(normalizeVin(vehicle.vin) || (vehicle.year && vehicle.make));
}

function looksLikeEstimateNoise(value?: string | null): boolean {
  if (!value) return false;
  const lower = value.toLowerCase();
  const estimateTokens = ["r&i", "rpr", "repl", "blnd", "refn", "scan", "cal"];
  const matchCount = estimateTokens.filter((token) => lower.includes(token)).length;
  return matchCount >= 3 || /(?:\b[a-z]{2,5}\b\s+){6,}/i.test(lower) && lower.includes(" r&i ");
}

function sanitizeNarrative(value?: string | null): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!cleaned || looksLikeEstimateNoise(cleaned)) {
    return null;
  }

  return cleaned;
}

function isSpecificSupplementItem(value?: string): boolean {
  if (!value) return false;
  const lower = value.toLowerCase();

  if (
    lower.includes("carrier estimate") ||
    lower.includes("shop estimate") ||
    lower.includes("repair story") ||
    lower.includes("support gaps") ||
    lower.includes("narrows repair scope") ||
    lower.includes("story alignment") ||
    lower.includes("estimate appears")
  ) {
    return false;
  }

  return (
    lower.includes("scan") ||
    lower.includes("calibration") ||
    lower.includes("radar") ||
    lower.includes("camera") ||
    lower.includes("sensor") ||
    lower.includes("alignment") ||
    lower.includes("setup") ||
    lower.includes("test fit") ||
    lower.includes("fit-sensitive") ||
    lower.includes("fit sensitive") ||
    lower.includes("fender") ||
    lower.includes("bumper") ||
    lower.includes("lamp") ||
    lower.includes("replace vs repair") ||
    lower.includes("repair vs replace") ||
    lower.includes("access") ||
    lower.includes("coolant") ||
    lower.includes("bleed") ||
    lower.includes("purge") ||
    lower.includes("seam") ||
    lower.includes("corrosion") ||
    lower.includes("primer") ||
    lower.includes("wax") ||
    lower.includes("tie bar") ||
    lower.includes("lock support") ||
    lower.includes("core support") ||
    lower.includes("measure") ||
    lower.includes("section") ||
    lower.includes("weld") ||
    lower.includes("airbag") ||
    lower.includes("seat belt") ||
    lower.includes("road test")
  );
}

function buildIssueEvidence(
  report: RepairIntelligenceReport | null,
  evidenceIds: string[],
  title?: string
): string | undefined {
  if (!report || evidenceIds.length === 0) return undefined;

  const relevantEvidence = report.evidence
    .filter((entry) => evidenceIds.includes(entry.id))
    .filter((entry) => isRelevantEvidenceForSupplement(title, entry.title, entry.snippet))
    .slice(0, 2)
    .map((entry) => `${entry.title}: ${entry.snippet}`)
    .join(" | ");

  if (relevantEvidence) {
    return relevantEvidence;
  }

  const fallbackEvidence = report.evidence
    .filter((entry) => evidenceIds.includes(entry.id))
    .slice(0, 1)
    .map((entry) => `${entry.title}: ${entry.snippet}`)
    .join(" | ");

  return fallbackEvidence || undefined;
}

function isRelevantEvidenceForSupplement(
  title: string | undefined,
  evidenceTitle?: string,
  evidenceSnippet?: string
): boolean {
  if (!title) return true;

  const haystack = `${evidenceTitle ?? ""} ${evidenceSnippet ?? ""}`.toLowerCase();

  if (title === "Seam Sealer Restoration") {
    if (
      haystack.includes("color coat application") ||
      haystack.includes("bagging") ||
      haystack.includes("three-stage finish") ||
      haystack.includes("three stage finish") ||
      haystack.includes("color blend")
    ) {
      return false;
    }

    return (
      haystack.includes("seam sealer") ||
      haystack.includes("sealer") ||
      haystack.includes("joint sealing") ||
      haystack.includes("corrosion") ||
      haystack.includes("cavity wax") ||
      haystack.includes("weld protection")
    );
  }

  return true;
}

function isContradictorySupportiveDraft(
  draft: string,
  report: RepairIntelligenceReport | null,
  supplementItems: ExportSupplementItem[]
): boolean {
  const lower = draft.toLowerCase();
  const soundsComplete =
    lower.includes("appears to support a complete repair process") ||
    lower.includes("support a complete repair process");
  const hasGapSignals =
    (report?.summary.criticalIssues ?? 0) > 0 ||
    (report?.missingProcedures.length ?? 0) > 0 ||
    supplementItems.length > 0;

  return soundsComplete && hasGapSignals;
}

function mergePriority(
  left: ExportSupplementItem["priority"],
  right: ExportSupplementItem["priority"]
): ExportSupplementItem["priority"] {
  if (left === "high" || right === "high") return "high";
  if (left === "medium" || right === "medium") return "medium";
  return "low";
}

function paramsToAnalysisFindings(
  report: RepairIntelligenceReport | null,
  panel: DecisionPanel | null
): Array<{
  title: string;
  reason: string;
  evidence?: string;
  source?: string;
  priority: "low" | "medium" | "high";
}> {
  const items: Array<{
    title: string;
    reason: string;
    evidence?: string;
    source?: string;
    priority: "low" | "medium" | "high";
  }> = [];

  if (report) {
    for (const issue of report.issues) {
      if (isSpecificSupplementItem(issue.title)) {
        items.push({
          title: issue.title,
          reason: issue.impact || issue.finding,
          evidence: buildIssueEvidence(report, issue.evidenceIds, deriveSupplementTitle(issue.title)),
          source: issue.category,
          priority: issue.severity,
        });
      }
    }
  }

  if (panel) {
    for (const item of panel.supplements) {
      if (isSpecificSupplementItem(item.mappedLabel || item.title)) {
        items.push({
          title: item.mappedLabel || item.title,
          reason: item.rationale,
          evidence: item.support,
          source: "Decision panel",
          priority: "medium",
        });
      }
    }
  }

  return items;
}
