import {
  buildExportModel,
  COLLISION_ACADEMY_HANDOFF_URL,
  redactExportModelForDownload,
  resolveCanonicalInsurer,
  resolveCanonicalVehicleLabel,
  resolveCanonicalVin,
  type ExportModel,
} from "./buildExportModel";
import type { AnalysisResult, RepairIntelligenceReport } from "../types/analysis";
import type { ExportBuilderInput } from "./exportTemplates";
import { normalizeWorkspaceEstimateComparisons } from "@/lib/workspace/estimateComparisons";
import { dedupeEstimateComparisonRationales } from "@/components/workspace/estimateComparisonPresentation";

export type CarrierReportSection = {
  title: string;
  body?: string;
  bullets?: string[];
  comparisonRows?: Array<{
    label: string;
    leftLabel: string;
    leftValue: string;
    rightLabel: string;
    rightValue: string;
    delta?: string;
    note?: string;
  }>;
};

export type CarrierReportDocument = {
  filename?: string;
  brand: {
    companyName: string;
    reportLabel: string;
    logoPath: string;
  };
  header: {
    title: string;
    subtitle: string;
    generatedLabel: string;
  };
  summary: Array<{
    label: string;
    value: string;
  }>;
  sections: CarrierReportSection[];
  footer: string[];
};

export function buildCarrierReport({
  report,
  analysis,
  panel,
  assistantAnalysis,
  renderModel,
  workspaceData,
}: ExportBuilderInput): CarrierReportDocument {
  const exportModel = resolveCarrierExportModel({
    report,
    analysis,
    panel,
    assistantAnalysis,
    renderModel,
  });

  const topItems = selectReportSupplementItems(exportModel.supplementItems);
  const isComparison = (analysis?.mode ?? report?.analysis?.mode) === "comparison";
  const documentedStrengths = exportModel.reportFields.presentStrengths;
  const fallbackComparisons =
    analysis?.estimateComparisons ?? report?.analysis?.estimateComparisons;
  const structuredComparisons = normalizeWorkspaceEstimateComparisons(
    workspaceData ? (workspaceData.estimateComparisons ?? null) : fallbackComparisons
  );
  const dedupedComparisonRows = dedupeEstimateComparisonRationales(structuredComparisons.rows);
  const strongestDisputes =
    topItems.length > 0
      ? joinHumanList(topItems.slice(0, 4).map((item) => item.title.toLowerCase()))
      : "no major unresolved support items identified from the current file";
  const credibilityConclusion = buildCredibilityConclusion(exportModel);
  const whyItWins = buildWhyItWins(exportModel, report, analysis);

  const canonicalVehicle = resolveCanonicalVehicleLabel(exportModel) ?? "Unspecified";
  const canonicalVin = resolveCanonicalVin(exportModel) ?? "Unspecified";
  const canonicalInsurer = resolveCanonicalInsurer(exportModel);

  return {
    filename: "collision-iq-main-report.pdf",
    brand: {
      companyName: "Collision Academy",
      reportLabel: "Collision Repair Intelligence Report",
      logoPath: "/brand/logos/logo-horizontal.png",
    },
    header: {
      title: "Collision Repair Supplement & Evaluation",
      subtitle:
        "Professional repair-position summary built from the current estimate, structured analysis, and supporting documentation.",
      generatedLabel: `Generated ${new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })}`,
    },
    summary: [
      {
        label: "Vehicle",
        value: canonicalVehicle,
      },
      {
        label: "VIN",
        value: canonicalVin,
      },
      ...(canonicalInsurer
        ? [{ label: "Insurer", value: canonicalInsurer }]
        : []),
      ...(typeof exportModel.reportFields.mileage === "number"
        ? [{ label: "Mileage", value: exportModel.reportFields.mileage.toLocaleString("en-US") }]
        : []),
      ...(typeof exportModel.reportFields.estimateTotal === "number"
        ? [{ label: "Estimate Total", value: formatMoneyPrecise(exportModel.reportFields.estimateTotal) }]
        : []),
      {
        label: "Repair Conclusion",
        value: credibilityConclusion,
      },
      {
        label: isComparison ? "Primary Dispute Areas" : "Primary Review Focus",
        value: strongestDisputes,
      },
    ],
    sections: [
      {
        title: "Executive Repair Position",
        body: buildExecutiveSummary({
          isComparison,
          credibilityConclusion,
          whyItWins,
          strongestDisputes,
        }),
      },
      {
        title: "Vehicle / File Summary",
        bullets: compact([
          canonicalVehicle !== "Unspecified"
            ? `Vehicle: ${canonicalVehicle}.`
            : undefined,
          canonicalInsurer ? `Insurer: ${canonicalInsurer}.` : undefined,
          typeof exportModel.reportFields.mileage === "number"
            ? `Mileage: ${exportModel.reportFields.mileage.toLocaleString("en-US")}.`
            : undefined,
          typeof exportModel.reportFields.estimateTotal === "number"
            ? `Estimate total: ${formatMoneyPrecise(exportModel.reportFields.estimateTotal)}.`
            : undefined,
          exportModel.vehicle.manufacturer ? `Manufacturer: ${exportModel.vehicle.manufacturer}.` : undefined,
          exportModel.vehicle.trim ? `Trim: ${exportModel.vehicle.trim}.` : undefined,
          resolveCanonicalVin(exportModel) ? `VIN: ${resolveCanonicalVin(exportModel)}.` : undefined,
          `Confidence: ${formatVehicleConfidence(exportModel)}.`,
          report ? `Structured analysis confidence: ${capitalize(report.summary.confidence)}.` : undefined,
          report ? `Evidence quality: ${capitalize(report.summary.evidenceQuality)}.` : undefined,
        ]),
      },
      {
        title: "Key Findings / What Stands Out",
        body: exportModel.repairPosition,
      },
      {
        title: isComparison ? "Repair Strategy Comparison" : "Repair Review Summary",
        bullets: compact([
          credibilityConclusion,
          whyItWins,
          topItems.length > 0
            ? isComparison
              ? `The clearest dispute areas are ${joinHumanList(topItems.slice(0, 4).map((item) => item.title.toLowerCase()))}.`
              : `Support remains open on ${joinHumanList(topItems.slice(0, 4).map((item) => item.title.toLowerCase()))}.`
            : undefined,
        ]),
      },
      ...(dedupedComparisonRows.length > 0
        ? [{
            title: "Structured Estimate Comparison",
            comparisonRows: dedupedComparisonRows.slice(0, 8).map((row) => ({
              label: [row.category, row.operation, row.partName]
                .filter(Boolean)
                .join(" - ") || "Comparison",
              leftLabel: row.lhsSource ?? "Shop",
              leftValue: formatComparisonSide(row.lhsValue),
              rightLabel: row.rhsSource ?? "Carrier",
              rightValue: formatComparisonSide(row.rhsValue),
              delta:
                row.delta !== null && row.delta !== undefined && `${row.delta}`.trim() !== ""
                  ? `${row.delta}`
                  : undefined,
              note: row.notes?.[0],
            })),
          }]
        : []),
      ...(documentedStrengths.length > 0
        ? [{
            title: isComparison ? "Documented Positives (Shop File)" : "Documented Positives",
            bullets: documentedStrengths.map((item) => `${item}.`),
          }]
        : []),
      {
        title: isComparison ? "Supportable Supplement / Dispute Items" : "Supportable Review Items",
        bullets:
          topItems.length > 0
            ? topItems.map((item) =>
                `${item.title}: ${item.rationale}${item.evidence ? ` Support noted: ${item.evidence}` : ""}`
              )
            : ["No clear supportable missing, underwritten, or disputed estimate-support items were identified from the current file."],
      },
      {
        title: "Negotiation / Rebuttal Support",
        body: exportModel.request,
      },
      {
        title: "Valuation Preview",
        bullets: buildValuationBullets(exportModel),
      },
      {
        title: "Source / Document Summary",
        bullets: buildSourceSummary(report, analysis, exportModel),
      },
    ],
    footer: [
      "This report is a repair-position and documentation-support summary based on the current material.",
      `ACV and diminished value references are preliminary only. For a full valuation, continue at ${COLLISION_ACADEMY_HANDOFF_URL}`,
    ],
  };
}

function buildExecutiveSummary(params: {
  isComparison: boolean;
  credibilityConclusion: string;
  whyItWins: string;
  strongestDisputes: string;
}): string {
  const sentences = [
    params.credibilityConclusion,
    params.whyItWins,
    params.isComparison
      ? `The biggest remaining differences are ${params.strongestDisputes}.`
      : `Support remains open on ${params.strongestDisputes}.`,
  ].filter(Boolean);

  const kept: string[] = [];
  const seenConcepts = new Set<string>();

  for (const sentence of sentences) {
    const concept = normalizeCarrierConclusionConcept(sentence);
    if (concept && seenConcepts.has(concept)) {
      continue;
    }
    if (concept) {
      seenConcepts.add(concept);
    }
    kept.push(sentence);
  }

  return kept.join(" ");
}

function resolveCarrierExportModel(params: ExportBuilderInput): ExportModel {
  if (params.renderModel) {
    return redactExportModelForDownload(params.renderModel);
  }

  return redactExportModelForDownload(
    buildExportModel({
      report: params.report,
      analysis: params.analysis,
      panel: params.panel,
      assistantAnalysis: params.assistantAnalysis,
    })
  );
}

function formatComparisonSide(value: string | number | null | undefined): string {
  if (value === null || value === undefined || `${value}`.trim() === "") {
    return "not shown";
  }

  return `${value}`;
}

function buildCredibilityConclusion(
  exportModel: ReturnType<typeof buildExportModel>
): string {
  const lower = exportModel.repairPosition.toLowerCase();
  const isComparison = /\b(shop estimate|carrier estimate)\b/i.test(exportModel.repairPosition);

  if (isComparison && lower.includes("shop estimate") && lower.includes("more complete")) {
    return "The shop estimate currently reads as the more credible repair document.";
  }

  if (isComparison && lower.includes("carrier estimate") && lower.includes("underwritten")) {
    return "The carrier estimate currently reads as underwritten against the stronger repair path.";
  }

  if (exportModel.supplementItems.length > 0) {
    return isComparison
      ? "The estimate is credible as a preliminary repair plan, but the stronger position is the one that best supports the listed procedures, verifications, and scope items."
      : "The file documents a credible preliminary repair plan, with several repair, verification, or documentation items still needing clearer support.";
  }

  return isComparison
    ? "The current material shows no major unresolved support split."
    : "The current file supports a generally credible estimate review with no major unresolved support issue.";
}

function buildWhyItWins(
  exportModel: ReturnType<typeof buildExportModel>,
  report: RepairIntelligenceReport | null,
  analysis: AnalysisResult | null
): string {
  const topItems = exportModel.supplementItems.slice(0, 3);
  if (topItems.length > 0) {
    const analysisMode = analysis?.mode ?? report?.analysis?.mode;
    return analysisMode === "comparison"
      ? `It is stronger because the current file supports ${joinHumanList(
          topItems.map((item) => item.title.toLowerCase())
        )} more clearly than the competing posture.`
      : `The file most clearly leaves open ${joinHumanList(
          topItems.map((item) => item.title.toLowerCase())
        )}.`;
  }

  if (analysis?.narrative) {
    return cleanCarrierSummarySentence(analysis.narrative);
  }

  if (report?.recommendedActions?.length) {
    return cleanCarrierSummarySentence(report.recommendedActions[0]);
  }

  return "The file is best read through what it documents clearly, what remains open, and what still needs support or documentation.";
}

function buildValuationBullets(
  exportModel: ReturnType<typeof buildExportModel>
): string[] {
  const bullets: string[] = [];
  const valuation = exportModel.valuation;

  bullets.push(renderValuationBullet("ACV", {
    status: valuation.acvStatus,
    value: valuation.acvValue,
    range: valuation.acvRange,
    confidence: valuation.acvConfidence,
    reasoning: valuation.acvReasoning,
    missingInputs: valuation.acvMissingInputs,
  }));

  bullets.push(renderValuationBullet("Diminished Value", {
    status: valuation.dvStatus,
    value: valuation.dvValue,
    range: valuation.dvRange,
    confidence: valuation.dvConfidence,
    reasoning: valuation.dvReasoning,
    missingInputs: valuation.dvMissingInputs,
  }));

  bullets.push("These valuation figures are preliminary previews only, not formal appraisals or binding valuations.");
  bullets.push(`For a full valuation, continue at ${COLLISION_ACADEMY_HANDOFF_URL}.`);
  return bullets;
}

function renderValuationBullet(
  label: string,
  params: {
    status: "provided" | "estimated_range" | "not_determinable";
    value?: number;
    range?: { low: number; high: number };
    confidence?: "low" | "medium" | "high";
    reasoning: string;
    missingInputs: string[];
  }
): string {
  const parts: string[] = [];

  if (params.status === "provided" && typeof params.value === "number") {
    parts.push(`${label}: preliminary preview ${formatMoney(params.value)}`);
  } else if (params.status === "estimated_range" && params.range) {
    parts.push(`${label}: preliminary preview ${formatMoney(params.range.low)}-${formatMoney(params.range.high)}`);
  } else {
    parts.push(`${label}: not determinable from the current documents`);
  }

  if (params.confidence) {
    parts.push(`confidence ${params.confidence}`);
  }

  const cleanedReasoning = cleanValuationReasoning(params.reasoning);
  if (cleanedReasoning) {
    parts.push(cleanedReasoning);
  }

  if (params.missingInputs.length > 0) {
    parts.push(`missing inputs include ${params.missingInputs.join(", ")}`);
  }

  return parts.join(". ").replace(/\.\./g, ".") + ".";
}

function buildSourceSummary(
  report: RepairIntelligenceReport | null,
  analysis: AnalysisResult | null,
  exportModel: ReturnType<typeof buildExportModel>
): string[] {
  const sources = new Set<string>();

  for (const item of exportModel.supplementItems) {
    if (item.source) {
      sources.add(item.source);
    }
  }

  for (const evidence of report?.evidence ?? []) {
    if (evidence.title) {
      sources.add(evidence.title);
    }
    if (evidence.source) {
      sources.add(evidence.source);
    }
  }

  for (const evidence of analysis?.evidence ?? []) {
    if (evidence.source) {
      sources.add(evidence.source);
    }
  }

  const resolved = [...sources].slice(0, 8);
  if (resolved.length === 0) {
    return ["References are limited to the current estimate, uploaded documents, and related file material."];
  }

  const cleaned = resolved
    .map((source) => toHumanReadableSourceLabel(source))
    .filter((source): source is string => Boolean(source))
    .slice(0, 8);

  if (cleaned.length === 0) {
    return ["References are limited to the current estimate, uploaded documents, and related file material."];
  }

  return cleaned.map((source) => `${trimTrailingPunctuation(source)}.`);
}

function formatMoney(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function formatMoneyPrecise(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatVehicleConfidence(
  exportModel: ReturnType<typeof buildExportModel>
): string {
  const label = capitalize(exportModel.vehicle.confidence);
  if (typeof exportModel.vehicle.sourceConfidence !== "number") {
    return label;
  }

  return `${label} (${exportModel.vehicle.sourceConfidence.toFixed(2)})`;
}

function cleanValuationReasoning(reasoning?: string | null): string | null {
  if (!reasoning) return null;
  const cleaned = reasoning.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  if (
    /^(acv|dv|diminished value)\s+is\s+not determinable from the current documents\.?$/i.test(cleaned) ||
    /^not determinable from the current documents\.?$/i.test(cleaned)
  ) {
    return null;
  }
  return trimTrailingPunctuation(cleaned);
}

function selectReportSupplementItems(
  items: ReturnType<typeof buildExportModel>["supplementItems"]
): ReturnType<typeof buildExportModel>["supplementItems"] {
  if (items.length <= 8) {
    return items;
  }

  const categorySeen = new Set<string>();
  const selected: ReturnType<typeof buildExportModel>["supplementItems"] = [];

  for (const item of items) {
    if (!categorySeen.has(item.category)) {
      selected.push(item);
      categorySeen.add(item.category);
    }
    if (selected.length >= 5) {
      break;
    }
  }

  for (const item of items) {
    if (selected.some((existing) => existing.title === item.title)) {
      continue;
    }
    selected.push(item);
    if (selected.length >= 8) {
      break;
    }
  }

  return selected.slice(0, 8);
}

function toHumanReadableSourceLabel(source: string): string | undefined {
  const trimmed = trimTrailingPunctuation(source).trim();
  if (!trimmed) return undefined;
  if (
    /repair-pipeline|pipeline evidence|assistant reasoning|structured narrative|structured analysis|supplement analysis|missing procedures|scan analysis|calibration analysis|drive knowledge base|retrieved evidence|^inline-\d+$|^retrieved-\d+$/i.test(
      trimmed
    )
  ) {
    return undefined;
  }

  const lastSegment = trimmed.split(/[\\/]/).pop()?.trim() ?? trimmed;
  const withoutOpaqueId = lastSegment.replace(/\b[a-z0-9_-]{20,}\b/gi, "").replace(/\s{2,}/g, " ").trim();
  if (!withoutOpaqueId) return undefined;
  if (/^[a-z0-9_-]{12,}$/i.test(withoutOpaqueId)) return undefined;
  if (/\.(pdf|docx?|xlsx?|png|jpe?g|heic|txt)$/i.test(withoutOpaqueId)) {
    return withoutOpaqueId;
  }
  if (withoutOpaqueId.split(/\s+/).length <= 1 && !/[A-Z]/.test(withoutOpaqueId)) {
    return undefined;
  }
  return withoutOpaqueId;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function joinHumanList(values: string[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function trimTrailingPunctuation(value: string): string {
  return value.replace(/[.!\s]+$/g, "").trim();
}

function cleanCarrierSummarySentence(value?: string | null): string {
  const cleaned = (value ?? "")
    .replace(
      /(?:^|[\s.])Areas that look aggressive or likely to get pushback\s*:?\s*(?:\.)?(?=\s|$)/gi,
      " "
    )
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!cleaned) {
    return "The file is best read through what it documents clearly, what remains open, and what still needs support or documentation.";
  }

  return trimTrailingPunctuation(cleaned) + ".";
}

function normalizeCarrierConclusionConcept(value: string): string | null {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (
    normalized.includes("credible") ||
    normalized.includes("preliminary repair plan") ||
    normalized.includes("generally credible estimate") ||
    normalized.includes("more credible repair document")
  ) {
    return "credibility";
  }

  if (
    normalized.includes("remaining gaps") ||
    normalized.includes("dispute areas") ||
    normalized.includes("needs clearer support around")
  ) {
    return "gaps";
  }

  return null;
}

function compact(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value && value.trim()));
}
