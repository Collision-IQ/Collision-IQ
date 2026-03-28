import {
  buildExportModel,
  buildPreferredVehicleIdentityLabel,
  COLLISION_ACADEMY_HANDOFF_URL,
} from "./buildExportModel";
import type { DecisionPanel } from "./buildDecisionPanel";
import type { AnalysisResult, RepairIntelligenceReport } from "../types/analysis";

export type CarrierReportSection = {
  title: string;
  body?: string;
  bullets?: string[];
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
}: {
  report: RepairIntelligenceReport | null;
  analysis: AnalysisResult | null;
  panel: DecisionPanel | null;
  assistantAnalysis?: string | null;
}): CarrierReportDocument {
  const exportModel = buildExportModel({
    report,
    analysis,
    panel,
    assistantAnalysis,
  });

  const topItems = selectReportSupplementItems(exportModel.supplementItems);
  const strongestDisputes =
    topItems.length > 0
      ? joinHumanList(topItems.slice(0, 4).map((item) => item.title.toLowerCase()))
      : "no major unresolved support gaps identified from the current structured analysis";
  const credibilityConclusion = buildCredibilityConclusion(exportModel);
  const whyItWins = buildWhyItWins(exportModel, report, analysis);

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
        value: buildVehicleIdentityValue(exportModel),
      },
      {
        label: "VIN",
        value: exportModel.vehicle.vin || "Not clearly supported in the current material.",
      },
      {
        label: "Repair Conclusion",
        value: credibilityConclusion,
      },
      {
        label: "Primary Dispute Areas",
        value: strongestDisputes,
      },
    ],
    sections: [
      {
        title: "Executive Repair Position",
        body: buildExecutiveSummary({
          credibilityConclusion,
          whyItWins,
          strongestDisputes,
        }),
      },
      {
        title: "Vehicle / File Summary",
        bullets: compact([
          buildVehicleIdentityValue(exportModel) !== "Unspecified"
            ? `Vehicle: ${buildVehicleIdentityValue(exportModel)}.`
            : undefined,
          exportModel.vehicle.manufacturer ? `Manufacturer: ${exportModel.vehicle.manufacturer}.` : undefined,
          exportModel.vehicle.trim ? `Trim: ${exportModel.vehicle.trim}.` : undefined,
          exportModel.vehicle.vin ? `VIN: ${exportModel.vehicle.vin}.` : undefined,
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
        title: "Repair Strategy Comparison",
        bullets: compact([
          credibilityConclusion,
          whyItWins,
          topItems.length > 0
            ? `The clearest dispute areas are ${joinHumanList(topItems.slice(0, 4).map((item) => item.title.toLowerCase()))}.`
            : undefined,
        ]),
      },
      {
        title: "Supportable Supplement / Dispute Items",
        bullets:
          topItems.length > 0
            ? topItems.map((item) =>
                `${item.title}: ${item.rationale}${item.evidence ? ` Evidence: ${item.evidence}` : ""}${item.source ? ` Source: ${item.source}.` : ""}`
              )
            : ["No clear supportable missing, underwritten, or disputed repair-path items were identified from the current structured analysis."],
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
  credibilityConclusion: string;
  whyItWins: string;
  strongestDisputes: string;
}): string {
  return [
    params.credibilityConclusion,
    params.whyItWins,
    `The biggest current dispute areas are ${params.strongestDisputes}.`,
  ].join(" ");
}

function buildVehicleIdentityValue(
  exportModel: ReturnType<typeof buildExportModel>
): string {
  const resolvedLabel = buildPreferredVehicleIdentityLabel(exportModel.vehicle);
  if (resolvedLabel) {
    return resolvedLabel;
  }

  const namedParts = [
    exportModel.vehicle.year,
    exportModel.vehicle.make,
    exportModel.vehicle.model,
    exportModel.vehicle.trim,
  ].filter(Boolean);

  if (namedParts.length > 0) {
    return namedParts.join(" ");
  }

  const partialIdentity = [
    exportModel.vehicle.make,
    exportModel.vehicle.model,
    exportModel.vehicle.manufacturer,
  ].filter(Boolean);

  if (partialIdentity.length > 0) {
    return partialIdentity.join(" ");
  }

  return "Unspecified";
}

function buildCredibilityConclusion(
  exportModel: ReturnType<typeof buildExportModel>
): string {
  const lower = exportModel.repairPosition.toLowerCase();

  if (lower.includes("shop estimate") && lower.includes("more complete")) {
    return "The shop estimate currently reads as the more credible repair document.";
  }

  if (lower.includes("carrier estimate") && lower.includes("underwritten")) {
    return "The carrier estimate currently reads as underwritten against the stronger repair path.";
  }

  if (exportModel.supplementItems.length > 0) {
    return "The stronger repair position is the one that best supports the listed procedures, verifications, and repair-path items.";
  }

  return "The current material does not show a major credibility split between repair positions.";
}

function buildWhyItWins(
  exportModel: ReturnType<typeof buildExportModel>,
  report: RepairIntelligenceReport | null,
  analysis: AnalysisResult | null
): string {
  const topItems = exportModel.supplementItems.slice(0, 3);
  if (topItems.length > 0) {
    return `It is stronger because the current file supports ${joinHumanList(
      topItems.map((item) => item.title.toLowerCase())
    )} more clearly than the competing posture.`;
  }

  if (analysis?.narrative) {
    return cleanCarrierSummarySentence(analysis.narrative);
  }

  if (report?.recommendedActions?.length) {
    return cleanCarrierSummarySentence(report.recommendedActions[0]);
  }

  return "The current support is driven by how well the file documents the intended repair path, verification burden, and disputed operations.";
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
    return ["Source references are limited to the current estimate, uploaded documents, and structured repair analysis."];
  }

  const cleaned = resolved
    .map((source) => toHumanReadableSourceLabel(source))
    .filter((source): source is string => Boolean(source))
    .slice(0, 8);

  if (cleaned.length === 0) {
    return ["Source references are limited to the current estimate, uploaded documents, and structured repair analysis."];
  }

  return cleaned.map((source) => `${trimTrailingPunctuation(source)}.`);
}

function formatMoney(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
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
  if (items.length <= 6) {
    return items;
  }

  const narrowFocus = new Set([
    "ADAS / Calibration Procedure Support",
    "Headlamp aiming check",
    "Seam Sealer Restoration",
  ]);

  const primary = items.filter((item) => !narrowFocus.has(item.title)).slice(0, 5);
  const fallback = items.filter((item) => narrowFocus.has(item.title)).slice(0, primary.length > 0 ? 1 : 3);
  return [...primary, ...fallback].slice(0, 6);
}

function toHumanReadableSourceLabel(source: string): string | undefined {
  const trimmed = trimTrailingPunctuation(source).trim();
  if (!trimmed) return undefined;
  if (
    /repair-pipeline|pipeline evidence|assistant reasoning|structured narrative|structured analysis|supplement analysis|missing procedures|scan analysis|calibration analysis|^inline-\d+$|^retrieved-\d+$/i.test(
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
    return "The current support is driven by how well the file documents the intended repair path, verification burden, and disputed operations.";
  }

  return trimTrailingPunctuation(cleaned) + ".";
}

function compact(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value && value.trim()));
}
