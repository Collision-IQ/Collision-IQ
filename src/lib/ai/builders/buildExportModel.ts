import type { DecisionPanel } from "./buildDecisionPanel";
import { deriveRenderInsightsFromChat, type DerivedValuation } from "./deriveRenderInsightsFromChat";
import { buildRepairStory } from "./buildRepairStory";
import {
  extractEstimateFacts,
  resolveCanonicalInsurerCandidate,
} from "../extractors/extractEstimateFacts";
import type { AnalysisResult, EstimateFacts, RepairIntelligenceReport, VehicleIdentity } from "../types/analysis";
import {
  buildVehicleLabel,
  decodeVinVehicleIdentity,
  extractVehicleIdentityFromText,
  isBetterVinCandidate,
  mergeVehicleIdentity,
  normalizeVehicleIdentity,
} from "../vehicleContext";
import {
  assessDisplayQuality,
  cleanDisplayLabel,
  cleanDisplayText,
  getDisplayVehicleInfo,
} from "../displayText";
import {
  deriveStructuralApplicability,
  filterStructuralTitles,
} from "../structuralApplicability";

export const COLLISION_ACADEMY_HANDOFF_URL = "https://www.collision.academy/";
const PLACEHOLDER_VEHICLE_LABEL_PATTERN =
  /^(?:unknown|unspecified|n\/a|na|none|null|undefined|not available|not provided|vehicle details are still limited in the current material\.?|vehicle details still limited in the current material\.?|not clearly supported(?: in the current material)?\.?)$/i;

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
  trim?: string;
  manufacturer?: string;
  confidence: "supported" | "partial" | "unknown";
  sourceConfidence?: number;
  fieldSources?: VehicleIdentity["fieldSources"];
  mismatches?: string[];
};

export type ExportModel = {
  vehicle: ExportVehicleInfo;
  estimateFacts: EstimateFacts;
  reportFields: ExportReportFields;
  repairPosition: string;
  positionStatement: string;
  supplementItems: ExportSupplementItem[];
  request: string;
  valuation: DerivedValuation;
};

export type ResolvedExportInput = {
  renderModel: ExportModel;
  report: RepairIntelligenceReport | null;
  analysis: AnalysisResult | null;
  panel: DecisionPanel | null;
  assistantAnalysis?: string | null;
};

export type ExportReportFields = {
  vehicleLabel?: string;
  vin?: string;
  mileage?: number;
  insurer?: string;
  estimateTotal?: number;
  documentedHighlights: string[];
  documentedProcedures: string[];
  presentStrengths: string[];
  likelySupplementAreas: string[];
  estimateFacts: EstimateFacts;
  vehicle?: VehicleIdentity;
};

const GENERIC_PLACEHOLDER_FIELD_PATTERN =
  /^(?:unknown|unspecified|n\/a|na|none|null|undefined|not available|not provided|vehicle details are still limited in the current material\.?|vehicle details still limited in the current material\.?|not clearly supported(?: in the current material)?\.?)$/i;

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
const PRESENTATION_DETAIL_BLOCK_PATTERN =
  /(?:^|\n)\s*(?:\d+[.)]|[-*•]|evidence:|details:|detail:|findings:|requested revisions|requested support)\s+/i;
const INLINE_ENUMERATION_PATTERN = /([.!?])\s+\d+[.)]\s+[\s\S]*$/;

export function buildExportModel(params: {
  report: RepairIntelligenceReport | null;
  analysis: AnalysisResult | null;
  panel: DecisionPanel | null;
  assistantAnalysis?: string | null;
}): ExportModel {
  const chatInsights = deriveRenderInsightsFromChat(params.assistantAnalysis ?? "");
  const reportFields = deriveExportReportFields({
    report: params.report,
    analysis: params.analysis,
  });
  const estimateFacts = reportFields.estimateFacts;
  const vehicle = inferVehicleInfo(
    params.report,
    params.analysis,
    estimateFacts
  );
  const supplementItems = buildExportSupplementItems(
    params.report,
    params.analysis,
    params.panel,
    chatInsights,
    params.assistantAnalysis ?? null,
    estimateFacts
  );
  const repairPosition = buildRepairPosition(
    params.report,
    params.analysis,
    params.panel,
    chatInsights.narrative ?? params.assistantAnalysis ?? null,
    supplementItems,
    reportFields
  );
  const positionStatement = buildPositionStatement(params.report, params.analysis, supplementItems);
  const request = buildRequest(params.report, params.panel, supplementItems, chatInsights.request);
  const valuation = buildValuation(params.panel, chatInsights.valuation, reportFields);
  const displayVehicle = getDisplayVehicleInfo(vehicle);
  const cleanedSupplementItems = supplementItems.map((item) => ({
    ...item,
    title: cleanDisplayLabel(item.title),
    rationale: cleanFormalExportText(item.rationale),
    evidence: item.evidence ? cleanFormalExportText(item.evidence) : undefined,
    source: item.source ? cleanFormalExportText(item.source) : undefined,
  }));
  const quality = assessDisplayQuality({
    vehicleLabel: displayVehicle.label ?? vehicle.label,
    vehicleTrim: displayVehicle.trim ?? vehicle.trim,
    supplementItems: cleanedSupplementItems,
  });
  const structuredVehicleLabel =
    [vehicle?.year, cleanDisplayLabel(vehicle?.make), cleanDisplayLabel(vehicle?.model)]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    [vehicle?.year, cleanDisplayLabel(vehicle?.make), cleanDisplayLabel(vehicle?.model), displayVehicle.trim]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    undefined;
  const guardedSupplementItems = quality.noisy
    ? cleanedSupplementItems.filter((item, index) => {
        if (index === 0) return true;
        const lower = item.title.toLowerCase();
        return lower.split(/\s+/).length >= 2 && !/\b(?:wheel|mirror|battery|panel)\b/i.test(lower);
      })
    : cleanedSupplementItems;
  const guardedVehicleLabel = quality.malformedVehicle
    ? structuredVehicleLabel
    : buildPreferredVehicleIdentityLabel({
        ...vehicle,
        label: reportFields.vehicleLabel ?? displayVehicle.label ?? structuredVehicleLabel ?? vehicle.label,
        trim: displayVehicle.trim ?? vehicle.trim,
      }) ?? reportFields.vehicleLabel ?? displayVehicle.label ?? structuredVehicleLabel ?? vehicle.label;
  const allLabelsSuppressed = quality.noisy && guardedSupplementItems.length === 0;
  const exportVehicle = {
    ...vehicle,
    label: guardedVehicleLabel,
    trim: displayVehicle.trim,
    vin: reportFields.vin ?? vehicle.vin,
    make: cleanDisplayLabel(vehicle.make),
    model: cleanDisplayLabel(vehicle.model),
    manufacturer: cleanDisplayText(vehicle.manufacturer),
  };

  console.info("[vehicle-label-trace:shared-export-model]", {
    sourceVehicle: vehicle ?? null,
    exportVehicle,
  });

  return {
    vehicle: exportVehicle,
    estimateFacts,
    reportFields,
    repairPosition: allLabelsSuppressed
      ? "The core repair conclusion remains intact, but noisy extracted labels were suppressed in this presentation view."
      : cleanFormalExportText(cleanPresentationProse(repairPosition)),
    positionStatement: allLabelsSuppressed
      ? "The main dispute areas remain supportable, but low-quality extracted labels were removed before rendering."
      : cleanFormalExportText(cleanPresentationProse(positionStatement)),
    supplementItems: guardedSupplementItems,
    request: allLabelsSuppressed
      ? "Please review the core dispute areas and provide clearer support for the intended repair path and verification steps."
      : cleanFormalExportText(request),
    valuation: {
      ...valuation,
      acvReasoning: cleanFormalExportText(valuation.acvReasoning),
      acvMissingInputs: valuation.acvMissingInputs.map((item) => cleanDisplayLabel(item)),
      dvReasoning: cleanFormalExportText(valuation.dvReasoning),
      dvMissingInputs: valuation.dvMissingInputs.map((item) => cleanDisplayLabel(item)),
    },
  };
}

export function deriveExportReportFields(params: {
  report: RepairIntelligenceReport | null;
  analysis: AnalysisResult | null;
}): ExportReportFields {
  const sourceText = collectVehicleDocumentText(params.report, params.analysis);
  const fallbackFacts = extractEstimateFacts({
    text: sourceText,
    vehicle: mergeVehicleIdentity(
      normalizeVehicleIdentity(params.report?.vehicle),
      normalizeVehicleIdentity(params.report?.analysis?.vehicle),
      normalizeVehicleIdentity(params.analysis?.vehicle)
    ),
  });

  const estimateFacts: EstimateFacts = {
    vehicle: mergeVehicleIdentity(
      normalizeVehicleIdentity(params.report?.estimateFacts?.vehicle),
      normalizeVehicleIdentity(params.report?.analysis?.estimateFacts?.vehicle),
      normalizeVehicleIdentity(params.analysis?.estimateFacts?.vehicle),
      normalizeVehicleIdentity(params.report?.vehicle),
      normalizeVehicleIdentity(params.report?.analysis?.vehicle),
      normalizeVehicleIdentity(params.analysis?.vehicle),
      normalizeVehicleIdentity(fallbackFacts.vehicle)
    ),
    mileage:
      params.report?.estimateFacts?.mileage ??
      params.report?.analysis?.estimateFacts?.mileage ??
      params.analysis?.estimateFacts?.mileage ??
      fallbackFacts.mileage,
    insurer: resolveCanonicalInsurerCandidate(
      { value: params.report?.estimateFacts?.insurer, source: "prior" },
      { value: params.report?.analysis?.estimateFacts?.insurer, source: "prior" },
      { value: params.analysis?.estimateFacts?.insurer, source: "prior" },
      { value: fallbackFacts.insurer, source: "known_carrier" }
    ),
    estimateTotal:
      params.report?.estimateFacts?.estimateTotal ??
      params.report?.analysis?.estimateFacts?.estimateTotal ??
      params.analysis?.estimateFacts?.estimateTotal ??
      fallbackFacts.estimateTotal,
    documentedProcedures: [
      ...new Set([
        ...(params.report?.estimateFacts?.documentedProcedures ?? []),
        ...(params.report?.analysis?.estimateFacts?.documentedProcedures ?? []),
        ...(params.analysis?.estimateFacts?.documentedProcedures ?? []),
        ...(fallbackFacts.documentedProcedures ?? []),
      ]),
    ],
    documentedHighlights: [
      ...new Set([
        ...(params.report?.estimateFacts?.documentedHighlights ?? []),
        ...(params.report?.analysis?.estimateFacts?.documentedHighlights ?? []),
        ...(params.analysis?.estimateFacts?.documentedHighlights ?? []),
        ...(fallbackFacts.documentedHighlights ?? []),
      ]),
    ],
  };

  const vehicle = mergeVehicleIdentity(
    normalizeVehicleIdentity(estimateFacts.vehicle),
    normalizeVehicleIdentity(params.report?.vehicle),
    normalizeVehicleIdentity(params.report?.analysis?.vehicle),
    normalizeVehicleIdentity(params.analysis?.vehicle),
    normalizeVehicleIdentity(fallbackFacts.vehicle)
  );
  const vehicleLabel =
    buildVehicleDisplayLabel(vehicle) ?? sanitizeVehicleDisplay(buildVehicleLabel(vehicle));
  const vin =
    normalizeVehicleIdentity(vehicle)?.vin ?? extractVinFromText(sourceText);
  const presentStrengths = [
    ...new Set([
      ...estimateFacts.documentedHighlights,
      ...estimateFacts.documentedProcedures,
    ]),
  ];
  const likelySupplementAreas = [
    ...new Set([
      ...(params.report?.supplementOpportunities ?? []),
      ...(params.report?.missingProcedures ?? []),
    ]),
  ];

  return {
    vehicleLabel,
    vin,
    mileage: estimateFacts.mileage,
    insurer: estimateFacts.insurer,
    estimateTotal: estimateFacts.estimateTotal,
    documentedHighlights: estimateFacts.documentedHighlights,
    documentedProcedures: estimateFacts.documentedProcedures,
    presentStrengths,
    likelySupplementAreas,
    estimateFacts,
    vehicle,
  };
}

function inferVehicleInfo(
  report: RepairIntelligenceReport | null,
  analysis: AnalysisResult | null,
  estimateFacts: EstimateFacts
): ExportVehicleInfo {
  const documentVehicleText = collectVehicleDocumentText(report, analysis);
  const structuredVehicle = mergeVehicleIdentity(
    normalizeVehicleIdentity(report?.vehicle),
    normalizeVehicleIdentity(report?.analysis?.vehicle),
    normalizeVehicleIdentity(analysis?.vehicle),
    normalizeVehicleIdentity(estimateFacts.vehicle)
  );
  const inferredVehicle = extractVehicleIdentityFromText(documentVehicleText, "attachment");
  const resolvedVin = resolveExportVin(structuredVehicle, inferredVehicle, documentVehicleText);
  const decodedVehicle = resolvedVin ? decodeVinVehicleIdentity(resolvedVin) : undefined;
  const vehicle = mergeVehicleIdentity(decodedVehicle, structuredVehicle, inferredVehicle);
  const decodedVehicleLabel = buildVehicleDisplayLabel(
    mergeVehicleIdentity(decodedVehicle, vehicle)
  );
  const structuredVehicleLabel = buildVehicleDisplayLabel(vehicle);
  const rawVehicleLabel = sanitizeVehicleDisplay(buildVehicleLabel(vehicle));
  const label =
    decodedVehicleLabel ??
    structuredVehicleLabel ??
    rawVehicleLabel;
  const detailCount = [vehicle?.year, vehicle?.make, vehicle?.model, vehicle?.vin, vehicle?.trim].filter(Boolean).length;

  console.info("[vehicle-reconciliation:report]", {
    structuredVehicle: structuredVehicle ?? null,
    decodedVehicle: decodedVehicle ?? null,
    inferredVehicle: inferredVehicle ?? null,
    resolvedVehicle: vehicle ?? null,
    resolvedVin: resolvedVin ?? null,
    hasDocumentVehicleText: Boolean(documentVehicleText.trim()),
  });

  console.info("[export-vehicle-selection]", {
    vinPresent: Boolean(resolvedVin),
    decodedVehiclePresent: Boolean(decodedVehicleLabel),
    structuredFieldsPresent: Boolean(vehicle?.year || vehicle?.make || vehicle?.model || vehicle?.trim),
    rawVehicleLabelPresent: Boolean(rawVehicleLabel),
    finalVehicle: label ?? "Unspecified",
  });

  return {
    label,
    vin: cleanDisplayText(resolvedVin),
    year: vehicle?.year,
    make: cleanDisplayLabel(vehicle?.make),
    model: cleanDisplayLabel(vehicle?.model),
    trim: cleanDisplayText(vehicle?.trim),
    manufacturer: cleanDisplayText(vehicle?.manufacturer),
    confidence:
      detailCount >= 3 || Boolean(vehicle?.vin)
        ? "supported"
        : detailCount >= 2
          ? "partial"
          : "unknown",
    sourceConfidence: vehicle?.confidence,
    fieldSources: vehicle?.fieldSources,
    mismatches: vehicle?.mismatches,
  };
}

function buildVehicleDisplayLabel(
  vehicle: VehicleIdentity | null | undefined
): string | undefined {
  const normalized = normalizeVehicleIdentity(vehicle);
  if (!normalized) return undefined;

  return sanitizeVehicleDisplay(
    [
      normalized.year,
      cleanDisplayLabel(normalized.make),
      cleanDisplayLabel(normalized.model),
      cleanDisplayText(normalized.trim),
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function sanitizeVehicleDisplay(value?: string | null): string | undefined {
  if (!value) return undefined;
  const cleaned = cleanDisplayText(value);
  if (!cleaned) return undefined;
  if (PLACEHOLDER_VEHICLE_LABEL_PATTERN.test(cleaned)) return undefined;
  return cleaned;
}

export function buildPreferredVehicleIdentityLabel(
  vehicle: ExportVehicleInfo | null | undefined,
  options?: { fallbackToVinTail?: boolean }
): string | undefined {
  if (!vehicle) return undefined;

  let resolvedLabel: string | undefined;
  const hasModel = Boolean(cleanDisplayLabel(vehicle.model));

  const fullIdentity = [
    vehicle.year,
    cleanDisplayLabel(vehicle.make),
    cleanDisplayLabel(vehicle.model),
    cleanDisplayText(vehicle.trim),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  const rejectedYearOnlyIdentity = looksLikeYearOnlyVehicleLabel(fullIdentity);
  const rejectedPartialIdentity = Boolean(fullIdentity && !hasModel);
  if (fullIdentity && !rejectedYearOnlyIdentity && !rejectedPartialIdentity) {
    resolvedLabel = sanitizeVehicleDisplay(fullIdentity);
    console.info("[vehicle-label-trace:display-helper]", {
      vehicle: vehicle ?? null,
      fullIdentity,
      resolvedLabel: resolvedLabel ?? null,
      source: "full_identity",
    });
    return resolvedLabel;
  }

  const namedIdentity = [
    vehicle.year,
    cleanDisplayLabel(vehicle.make),
    cleanDisplayLabel(vehicle.model),
    cleanDisplayText(vehicle.manufacturer),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  const rejectedYearOnlyNamedIdentity = looksLikeYearOnlyVehicleLabel(namedIdentity);
  const rejectedPartialNamedIdentity = Boolean(namedIdentity && !hasModel);
  if (namedIdentity && !rejectedYearOnlyNamedIdentity && !rejectedPartialNamedIdentity) {
    resolvedLabel = sanitizeVehicleDisplay(namedIdentity);
    console.info("[vehicle-label-trace:display-helper]", {
      vehicle: vehicle ?? null,
      namedIdentity,
      resolvedLabel: resolvedLabel ?? null,
      source: "named_identity",
    });
    return resolvedLabel;
  }

  const cleanedLabel = sanitizeVehicleDisplay(vehicle.label);
  const rejectedWeakCleanedLabel = looksLikeWeakVehicleIdentityLabel(cleanedLabel);
  if (cleanedLabel) {
    if (!looksLikeYearOnlyVehicleLabel(cleanedLabel) && !rejectedWeakCleanedLabel) {
      return cleanedLabel;
    }
  }

  if (
    (options?.fallbackToVinTail ||
      rejectedYearOnlyIdentity ||
      rejectedYearOnlyNamedIdentity ||
      rejectedPartialIdentity ||
      rejectedPartialNamedIdentity ||
      rejectedWeakCleanedLabel ||
      looksLikeYearOnlyVehicleLabel(cleanedLabel)) &&
    vehicle.vin
  ) {
    resolvedLabel = `VIN ending ${vehicle.vin.slice(-6)}`;
    console.info("[vehicle-label-trace:display-helper]", {
      vehicle: vehicle ?? null,
      cleanedLabel: cleanedLabel ?? null,
      resolvedLabel,
      source: "vin_tail_fallback",
    });
    return resolvedLabel;
  }

  if (cleanedLabel) {
    resolvedLabel = cleanedLabel;
    console.info("[vehicle-label-trace:display-helper]", {
      vehicle: vehicle ?? null,
      cleanedLabel,
      resolvedLabel,
      source: "cleaned_label_fallback",
    });
    return resolvedLabel;
  }

  console.info("[vehicle-label-trace:display-helper]", {
    vehicle: vehicle ?? null,
    resolvedLabel: null,
    source: "no_label",
  });
  return undefined;
}

export function buildPreferredRebuttalSubjectVehicleLabel(
  vehicle: ExportVehicleInfo | null | undefined
): string {
  const subjectMake = cleanDisplayLabel(vehicle?.make);
  const subjectModel = cleanDisplayLabel(vehicle?.model);
  const fullSubjectIdentity =
    subjectModel
      ? [
          vehicle?.year,
          subjectMake,
          subjectModel,
          cleanDisplayText(vehicle?.trim),
        ]
          .filter(Boolean)
          .join(" ")
          .trim()
      : undefined;

  return (
    sanitizeVehicleDisplay(fullSubjectIdentity) ??
    (vehicle?.vin ? `VIN ending ${vehicle.vin.slice(-6)}` : undefined) ??
    buildPreferredVehicleIdentityLabel(vehicle) ??
    "Current repair file"
  );
}

export function preferCanonicalField(
  resolved?: string | null,
  fallback?: string | null
): string | undefined {
  const preferred = sanitizeCanonicalField(resolved);
  if (preferred) {
    return preferred;
  }

  return sanitizeCanonicalField(fallback);
}

export function resolveCanonicalVehicleLabel(
  exportModel: Pick<ExportModel, "vehicle" | "reportFields">
): string | undefined {
  return preferCanonicalField(
    exportModel.reportFields.vehicleLabel,
    buildPreferredVehicleIdentityLabel(exportModel.vehicle)
  );
}

export function resolveCanonicalVin(
  exportModel: Pick<ExportModel, "vehicle" | "reportFields">
): string | undefined {
  return preferCanonicalField(exportModel.reportFields.vin, exportModel.vehicle.vin);
}

export function resolveCanonicalInsurer(
  exportModel: Pick<ExportModel, "reportFields" | "estimateFacts">
): string | undefined {
  return preferCanonicalField(
    exportModel.reportFields.insurer,
    exportModel.estimateFacts.insurer
  );
}

function sanitizeCanonicalField(value?: string | null): string | undefined {
  if (!value) return undefined;
  const cleaned = cleanDisplayText(value);
  if (!cleaned) return undefined;
  if (GENERIC_PLACEHOLDER_FIELD_PATTERN.test(cleaned)) return undefined;
  return cleaned;
}

function collectVehicleDocumentText(
  report: RepairIntelligenceReport | null,
  analysis: AnalysisResult | null
): string {
  return [
    report?.sourceEstimateText,
    report?.estimateFacts?.vehicle?.vin,
    report?.estimateFacts?.documentedProcedures?.join("\n"),
    report?.estimateFacts?.documentedHighlights?.join("\n"),
    report?.analysis?.rawEstimateText,
    analysis?.rawEstimateText,
    report?.vehicle?.vin,
    report?.analysis?.vehicle?.vin,
    analysis?.vehicle?.vin,
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

function resolveAnalysisMode(
  report: RepairIntelligenceReport | null,
  analysis: AnalysisResult | null
) {
  return analysis?.mode ?? report?.analysis?.mode ?? "single-document-review";
}

function buildSingleEstimateLead(
  estimateFacts: EstimateFacts,
  sourceEstimateText?: string | null
): string {
  const vehicleLabel = buildVehicleDisplayLabel(estimateFacts.vehicle);
  const story = sourceEstimateText?.trim() ? buildRepairStory(sourceEstimateText) : null;
  const facts: string[] = [];
  if (vehicleLabel) {
    facts.push(`vehicle ${vehicleLabel}`);
  }
  if (estimateFacts.insurer) {
    facts.push(`insurer ${estimateFacts.insurer}`);
  }
  if (typeof estimateFacts.mileage === "number") {
    facts.push(`mileage ${estimateFacts.mileage.toLocaleString("en-US")}`);
  }
  if (typeof estimateFacts.estimateTotal === "number") {
    facts.push(
      `estimate total $${estimateFacts.estimateTotal.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`
    );
  }

  const strengths = [
    ...new Set([
      ...estimateFacts.documentedHighlights,
      ...estimateFacts.documentedProcedures,
    ]),
  ]
    .slice(0, 5)
    .map((item) => item.toLowerCase());
  const factLead =
    facts.length > 0
      ? `Documented file facts show ${joinHumanList(facts)}.`
      : "The estimate provides enough documented facts to support a grounded preliminary review.";
  const strengthsLead =
    strengths.length > 0
      ? ` It already documents strengths such as ${joinHumanList(strengths)}.`
      : "";
  const scopeLead =
    story && (story.zones.length > 0 || story.panels.length > 0)
      ? ` The visible scope centers on ${joinHumanList(
          [
            story.impact !== "general" ? `${story.impact} damage` : undefined,
            story.zones.length > 0 ? `${joinHumanList(story.zones)} areas` : undefined,
            story.panels.length > 0 ? `${story.panels.length} noted panel${story.panels.length === 1 ? "" : "s"}` : undefined,
          ].filter((value): value is string => Boolean(value))
        )}.`
      : "";

  return `${factLead}${scopeLead}${strengthsLead} The current estimate appears directionally supportable, but additional scope may become clearer after teardown.`;
}

function extractVinFromText(text: string): string | undefined {
  const candidates = text.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/g) ?? [];
  let bestVin: string | undefined;

  for (const candidate of candidates) {
    const normalizedVin = normalizeVehicleIdentity({
      vin: candidate,
      source: "attachment",
    })?.vin;
    if (normalizedVin && isBetterVinCandidate(normalizedVin, bestVin)) {
      bestVin = normalizedVin;
    }
  }

  return bestVin;
}

function resolveExportVin(
  structuredVehicle: VehicleIdentity | null | undefined,
  inferredVehicle: VehicleIdentity | null | undefined,
  documentVehicleText: string
): string | undefined {
  let bestVin = normalizeVehicleIdentity(structuredVehicle)?.vin;

  const inferredVin = normalizeVehicleIdentity(inferredVehicle)?.vin;
  if (isBetterVinCandidate(inferredVin, bestVin)) {
    bestVin = inferredVin;
  }

  const fallbackVin = extractVinFromText(documentVehicleText);
  if (isBetterVinCandidate(fallbackVin, bestVin)) {
    bestVin = fallbackVin;
  }

  return bestVin;
}

function buildRepairPosition(
  report: RepairIntelligenceReport | null,
  analysis: AnalysisResult | null,
  panel: DecisionPanel | null,
  assistantAnalysis: string | null,
  supplementItems: ExportSupplementItem[],
  reportFields: ExportReportFields
): string {
  const estimateFacts = reportFields.estimateFacts;
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
  const isComparison = resolveAnalysisMode(report, analysis) === "comparison";
  const narrativeCandidates = isComparison
    ? candidates
    : candidates.filter((value) => !/\b(carrier estimate|shop estimate)\b/i.test(value));

  const strongestNarrative = narrativeCandidates
    .filter((value) => !looksLikeMetaCommentary(value))
    .sort((left, right) => scoreRepairNarrative(right) - scoreRepairNarrative(left))[0];

  if (supplementItems.length > 0) {
    const topItems = supplementItems.slice(0, 5);
    const topTitles = joinHumanList(topItems.map((item) => item.title.toLowerCase()));
    const lead = buildRepairPositionLead({
      isComparison,
      topItems,
      estimateFacts,
      estimateText:
        report?.sourceEstimateText ?? report?.analysis?.rawEstimateText ?? analysis?.rawEstimateText ?? null,
    });
    const issueBridge = buildRepairIssueBridge({
      isComparison,
      topItems,
      topTitles,
      reportFields,
    });

    if (strongestNarrative) {
      const polishedNarrative = makeRepairPositionTail(strongestNarrative);
      return polishedNarrative
        ? `${lead} ${issueBridge} ${polishedNarrative}.`
        : `${lead} ${issueBridge}`;
    }

    return `${lead} ${issueBridge}`;
  }

  const broaderNarrative = isComparison ? narrativeCandidates.find((value) => {
    const lower = value.toLowerCase();
    return (
      (lower.includes("carrier estimate") || lower.includes("shop estimate")) &&
      (lower.includes("underwritten") || lower.includes("more complete") || lower.includes("repair path"))
    );
  }) : undefined;

  if (broaderNarrative) {
    return trimTrailingPunctuation(broaderNarrative) + ".";
  }

  if (strongestNarrative) {
    return trimTrailingPunctuation(strongestNarrative) + ".";
  }

  if (supplementItems.length > 0) {
    return `The clearest remaining repair-path issues are ${joinHumanList(
      supplementItems.slice(0, 4).map((item) => item.title.toLowerCase())
    )}.`;
  }

  if (resolveAnalysisMode(report, analysis) !== "comparison") {
    return buildSingleEstimateLead(
      estimateFacts,
      report?.sourceEstimateText ?? report?.analysis?.rawEstimateText ?? analysis?.rawEstimateText ?? null
    );
  }

  return "The file does not point to a clear unresolved repair-path issue.";
}

function buildPositionStatement(
  report: RepairIntelligenceReport | null,
  analysis: AnalysisResult | null,
  supplementItems: ExportSupplementItem[]
): string {
  const unsupportedItems = supplementItems.length;
  const criticalCount = report?.summary.criticalIssues ?? 0;
  const isComparison = resolveAnalysisMode(report, analysis) === "comparison";

  if (criticalCount === 0 && unsupportedItems === 0) {
    return "The current material does not show a clear unsupported repair-process gap.";
  }

  if (supplementItems.length > 0) {
    const topItems = supplementItems.slice(0, 5);
    const topOperations = topItems.map((item) => item.title.toLowerCase());
    const kinds = new Set(topItems.map((item) => item.kind));
    const lead = buildPositionStatementLead({
      isComparison,
      kinds,
      topOperations,
    });

    return lead;
  }

  return "Key procedures or documentation still need clearer support before this estimate reads as fully defended.";
}

function buildRequest(
  report: RepairIntelligenceReport | null,
  panel: DecisionPanel | null,
  supplementItems: ExportSupplementItem[],
  chatRequest?: string
): string {
  if (supplementItems.length > 0) {
    const requestItems = selectConsistentSupplementItems(supplementItems);
    const heading = buildRequestHeading(requestItems);
    return [
      heading,
      ...requestItems.map((item) => {
        return `- ${item.title}: ${buildRequestLine(item)}`;
      }),
    ].join("\n");
  }

  if (chatRequest?.trim() && looksLikeCleanRequest(chatRequest)) {
    return sanitizeReason(chatRequest, "Please review and clarify how the repair plan is being supported.");
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
      "The file leaves the following items open; please provide updated support if they remain part of the intended repair plan:",
      ...topIssues,
    ].join("\n");
  }

  if (report?.recommendedActions?.length) {
    return sanitizeReason(
      report.recommendedActions[0],
      "Please review and clarify how the repair plan is being supported."
    );
  }

  return "Please review and clarify how the repair plan is being supported.";
}

function buildRepairPositionLead(params: {
  isComparison: boolean;
  topItems: ExportSupplementItem[];
  estimateFacts: EstimateFacts;
  estimateText: string | null;
}): string {
  if (params.isComparison) {
    const kinds = new Set(params.topItems.map((item) => item.kind));
    if (kinds.has("missing_operation") || kinds.has("missing_verification")) {
      return "Across the current file, the support gap is most noticeable in how several repair-path items are documented and verified.";
    }
    if (kinds.has("underwritten_operation")) {
      return "Across the current file, support appears uneven in several repair-process areas, and some items remain open or lightly documented.";
    }
    return "Across the current file, several repair-path items remain open enough that a single fully supported position is not yet established.";
  }

  return buildSingleEstimateLead(params.estimateFacts, params.estimateText);
}

function buildRepairIssueBridge(params: {
  isComparison: boolean;
  topItems: ExportSupplementItem[];
  topTitles: string;
  reportFields: ExportReportFields;
}): string {
  const hasDocumentedSupport =
    params.reportFields.documentedProcedures.length > 0 ||
    params.reportFields.documentedHighlights.length > 0;
  const kinds = new Set(params.topItems.map((item) => item.kind));

  if (hasDocumentedSupport && (kinds.has("missing_verification") || kinds.has("missing_operation"))) {
    return `The file documents several parts of the repair path clearly, but support remains open on ${params.topTitles}.`;
  }

  if (params.isComparison && kinds.has("underwritten_operation")) {
    return `The clearest separation in the file is around ${params.topTitles}.`;
  }

  if (kinds.has("disputed_repair_path") && !kinds.has("missing_operation") && !kinds.has("missing_verification")) {
    return `The file leaves the repair-path support most open around ${params.topTitles}.`;
  }

  return `The file leaves the following items least settled: ${params.topTitles}.`;
}

function buildPositionStatementLead(params: {
  isComparison: boolean;
  kinds: Set<ExportSupplementItem["kind"]>;
  topOperations: string[];
}): string {
  const joinedOperations = joinHumanList(params.topOperations);

  if (params.kinds.has("missing_verification")) {
    return params.isComparison
      ? `The current file leaves verification and documentation support open on ${joinedOperations}.`
      : `The file leaves verification and documentation support open on ${joinedOperations}.`;
  }

  if (params.kinds.has("missing_operation")) {
    return params.isComparison
      ? `The current file does not yet fully support the intended repair plan on ${joinedOperations}.`
      : `The file does not yet fully support the intended repair plan on ${joinedOperations}.`;
  }

  if (params.kinds.has("underwritten_operation")) {
    return params.isComparison
      ? `Support appears thinner on ${joinedOperations} in the current file, which keeps those repair-process items open.`
      : `Support remains light on ${joinedOperations}, which keeps those repair-process items open.`;
  }

  return params.isComparison
    ? `The current file still leaves the repair-path rationale most open on ${joinedOperations}.`
    : `The file still leaves the repair-path rationale most open on ${joinedOperations}.`;
}

function buildExportSupplementItems(
  report: RepairIntelligenceReport | null,
  analysis: AnalysisResult | null,
  panel: DecisionPanel | null,
  chatInsights: ReturnType<typeof deriveRenderInsightsFromChat>,
  assistantAnalysis: string | null,
  estimateFacts: EstimateFacts
): ExportSupplementItem[] {
  const defaultRationale = "This operation appears supportable but is not yet carried clearly in the current estimate.";
  const fromPanel: ExportSupplementItem[] =
    panel?.supplements
      .filter((item) => isSpecificSupplementItem(item.title) || isSpecificSupplementItem(item.mappedLabel))
      .map((item) => ({
      title: deriveSupplementTitle(item.mappedLabel || item.title),
      category: item.category,
      kind: inferSupplementKindFromText(item.rationale),
      rationale: sanitizeSupplementReason(
        deriveSupplementTitle(item.mappedLabel || item.title),
        item.rationale,
        defaultRationale
      ),
      evidence: sanitizeSupplementEvidence(
        deriveSupplementTitle(item.mappedLabel || item.title),
        item.support
      ),
      source: polishSourceLabel("Decision panel"),
      priority: "medium",
    })) ?? [];

  const fromMissingProcedures: ExportSupplementItem[] =
    report?.missingProcedures.map((procedure) => ({
      title: deriveSupplementTitle(procedure),
      category: inferSupplementCategory(procedure),
      kind: "missing_operation",
      rationale: "This function is not clearly represented in the current estimate.",
      source: polishSourceLabel("Missing procedure list"),
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
      rationale: sanitizeSupplementReason(item.title, item.raw, defaultRationale),
      source: polishSourceLabel("Supplement opportunity"),
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
        rationale: sanitizeSupplementReason(item.title, item.reason, defaultRationale),
        evidence: sanitizeSupplementEvidence(item.title, item.evidence),
        source: polishSourceLabel(item.source),
        priority: item.priority,
      }));

  const fromChatInsights: ExportSupplementItem[] = chatInsights.supplementItems
    .map((item) => ({
      ...item,
      title: deriveSupplementTitle(item.title || item.rationale),
      rationale: sanitizeSupplementReason(
        deriveSupplementTitle(item.title || item.rationale),
        item.rationale,
        defaultRationale
      ),
      evidence: sanitizeSupplementEvidence(
        deriveSupplementTitle(item.title || item.rationale),
        item.evidence
      ),
      source: polishSourceLabel(item.source),
    }))
    .filter((item) => isSpecificSupplementItem(item.title));

  const merged = [
    ...fromPanel,
    ...fromMissingProcedures,
    ...fromSupplementOpportunities,
    ...fromIssues,
    ...fromAnalysisFindings,
    ...fromChatInsights,
    ...synthesizeSupplementItemsFromNarrative({
      assistantAnalysis,
      analysisNarrative: analysis?.narrative ?? null,
      panelNarrative: panel?.narrative ?? null,
      recommendedActions: report?.recommendedActions ?? [],
    }),
  ];
  const structuralApplicability = deriveStructuralApplicability({
    vehicle: report?.vehicle ?? analysis?.vehicle ?? estimateFacts.vehicle,
    rawText: collectVehicleDocumentText(report, analysis),
    evidenceTexts: [
      ...(report?.evidence.map((entry) => `${entry.title ?? ""} ${entry.snippet ?? ""}`) ?? []),
      ...(analysis?.evidence.map((entry) => `${entry.source ?? ""} ${entry.quote ?? ""}`) ?? []),
    ],
    requiredProcedures: report?.requiredProcedures.map((entry) => entry.procedure),
    presentProcedures: report?.presentProcedures,
    missingProcedures: report?.missingProcedures,
    issueTexts: report?.issues.map((issue) => `${issue.title} ${issue.impact || issue.finding}`),
  });
  const deduped = new Map<string, ExportSupplementItem>();

  for (const item of filterStructuralTitles(merged, structuralApplicability)) {
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
  const filtered = resolved.filter((item) => !isContradictedByDocumentedFacts(item, estimateFacts));
  return filtered.map((item) => ({
    ...item,
    rationale: trimTrailingPunctuation(item.rationale) + ".",
    evidence: item.evidence ? trimTrailingPunctuation(item.evidence) + "." : undefined,
  }));
}

function buildValuation(
  panel: DecisionPanel | null,
  chatValuation: DerivedValuation,
  reportFields: ExportReportFields
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

  const canonicalAcvMissingInputs =
    normalizeAcvStatus(chatValuation) === "not_determinable"
      ? scrubValuationMissingInputs(
          chatValuation.acvMissingInputs.length
            ? chatValuation.acvMissingInputs
            : ["vehicle condition", "mileage", "trim/options", "market comparable data"],
          reportFields
        )
      : [];
  const canonicalDvMissingInputs =
    dvStatus === "not_determinable"
      ? scrubValuationMissingInputs(
          chatValuation.dvMissingInputs.length
            ? chatValuation.dvMissingInputs
            : ["repair severity context", "damage photos or confirmed repair scope", "pre-loss market context"],
          reportFields
        )
      : [];

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
      canonicalAcvMissingInputs
    ),
    acvReasoning:
      sanitizeReason(chatValuation.acvReasoning, "ACV is not determinable from the current documents.") ||
      "ACV is not determinable from the current documents.",
    acvMissingInputs: canonicalAcvMissingInputs,
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
      canonicalDvMissingInputs
    ),
    dvReasoning:
      sanitizeReason(
        hasChatDv ? chatValuation.dvReasoning : panel?.diminishedValue?.rationale,
        "DV is not determinable from the current documents."
      ) || "DV is not determinable from the current documents.",
    dvMissingInputs: canonicalDvMissingInputs,
  };
}

function scrubValuationMissingInputs(
  inputs: string[],
  reportFields: ExportReportFields
): string[] {
  return inputs
    .map((input) => {
      let cleaned = cleanDisplayLabel(input);
      const normalized = normalizeKey(cleaned);

      if (normalized.includes("mileage") && typeof reportFields.mileage === "number") {
        cleaned = cleaned
          .replace(/\bmileage\b/gi, "")
          .replace(/\s*\/\s*/g, " / ")
          .replace(/\s*,\s*/g, ", ")
          .replace(/(?:^|\s)[/,-](?=\s|$)/g, " ")
          .replace(/\(\s*\)/g, "")
          .replace(/\s{2,}/g, " ")
          .replace(/^(?:\/|,|-)\s*|\s*(?:\/|,|-)\s*$/g, "")
          .trim();
      }

      return cleaned;
    })
    .filter((input) => {
      const normalized = normalizeKey(input);
      if (!normalized) return false;

      if (normalized.includes("mileage") && typeof reportFields.mileage === "number") {
        return false;
      }

      if (
        (normalized.includes("trim") || normalized.includes("options")) &&
        Boolean(reportFields.vehicle?.trim || reportFields.vehicle?.model)
      ) {
        return false;
      }

      return true;
    });
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

  if (
    lower.includes("refinish") ||
    lower.includes("blend") ||
    lower.includes("tint") ||
    lower.includes("color sand") ||
    lower.includes("denib") ||
    lower.includes("polish") ||
    lower.includes("masking") ||
    lower.includes("edge prep") ||
    lower.includes("flex additive") ||
    lower.includes("let-down")
  ) {
    return "refinish";
  }

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
    evidence: sanitizeSupplementEvidence(title, buildIssueEvidence(report, issue.evidenceIds, title)),
    source: polishSourceLabel(issue.title),
    priority: issue.severity,
  };
}

function deriveSupplementTitle(value: string): string {
  const lower = value.toLowerCase();

  if (lower.includes("front structure scope")) {
    return "Front Structure Scope / Tie Bar / Upper Rail Reconciliation";
  }
  if (
    lower.includes("sidemember") ||
    lower.includes("support area") ||
    lower.includes("mounting geometry")
  ) {
    return "Hidden Mounting Geometry / Teardown Growth";
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
  if (
    lower.includes("headlamp aiming") ||
    lower.includes("headlamp aim") ||
    lower.includes("headlight aiming") ||
    lower.includes("headlight aim") ||
    (lower.includes("lamp") && lower.includes("aim"))
  ) {
    return "Headlamp aiming check";
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
  if (
    lower.includes("adas") ||
    lower.includes("camera") ||
    lower.includes("radar") ||
    lower.includes("sensor") ||
    lower.includes("calibration")
  ) {
    return "ADAS / Calibration Procedure Support";
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
  if (lower.includes("suspension")) {
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
  if (lower.includes("tint color") || lower.includes("let-down panel") || lower.includes("let down panel")) {
    return "Tint Color / Let-Down Panel";
  }
  if (
    lower.includes("finish sand and polish") ||
    lower.includes("color sand and buff") ||
    lower.includes("denib")
  ) {
    return "Finish Sand and Polish";
  }
  if (lower.includes("masking") || lower.includes("edge prep")) {
    return "Masking / Edge Prep";
  }
  if (lower.includes("three-stage refinish") || lower.includes("three stage refinish")) {
    return "Three-Stage Refinish Operation";
  }
  if (lower.includes("flex additive")) {
    return "Flex Additive";
  }
  if (lower.includes("blend")) {
    return "Blend / Blend Within Panel";
  }
  if (
    lower.includes("hardware") ||
    lower.includes("one-time-use") ||
    lower.includes("one time use") ||
    lower.includes("clip") ||
    lower.includes("seal") ||
    lower.includes("fastener")
  ) {
    return "One-Time-Use Hardware / Seals / Clips";
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

function isContradictedByDocumentedFacts(
  item: ExportSupplementItem,
  estimateFacts: EstimateFacts
): boolean {
  const normalizedDocumented = [
    ...estimateFacts.documentedProcedures,
    ...estimateFacts.documentedHighlights,
  ].map((value) => normalizeKey(value));
  const documented = new Set(normalizedDocumented);
  const itemKey = normalizeKey(item.title);
  const hasAnyScanCoverage = normalizedDocumented.some((value) =>
    /(pre repair scan|post repair scan|in process scan|in process repair scan|diagnostic scan|scan support|pre scan|post scan)/.test(
      value
    )
  );
  const hasPostScanCoverage = normalizedDocumented.some((value) =>
    /(post repair scan|post scan|final scan)/.test(value)
  );
  const hasPreScanCoverage = normalizedDocumented.some((value) =>
    /(pre repair scan|pre scan|diagnostic scan)/.test(value)
  );
  const hasInProcessScanCoverage = normalizedDocumented.some((value) =>
    /(in process scan|in process repair scan)/.test(value)
  );
  const hasCavityWaxCoverage = normalizedDocumented.some((value) =>
    /(cavity wax|corrosion protection)/.test(value)
  );

  if (!itemKey) return false;

  if (itemKey.includes("scan")) {
    if (itemKey.includes("post") && (hasPostScanCoverage || hasAnyScanCoverage)) {
      return true;
    }
    if (itemKey.includes("pre") && (hasPreScanCoverage || hasAnyScanCoverage)) {
      return true;
    }
    if (hasAnyScanCoverage) {
      return true;
    }
  }

  if (itemKey.includes("in process") && hasInProcessScanCoverage) {
    return true;
  }

  if (hasCavityWaxCoverage && itemKey.includes("corrosion protection")) {
    return true;
  }

  if (
    (itemKey === normalizeKey("Pre-Repair Scan") && documented.has(normalizeKey("Pre-repair scan"))) ||
    (itemKey === normalizeKey("Post-Repair Scan") && documented.has(normalizeKey("Post-repair scan"))) ||
    (itemKey === normalizeKey("In-process scan") && documented.has(normalizeKey("In-process scan"))) ||
    (itemKey === normalizeKey("In-process repair scan") && documented.has(normalizeKey("In-process repair scan"))) ||
    (itemKey === normalizeKey("Headlamp aiming check") && documented.has(normalizeKey("Headlamp/fog aim"))) ||
    (itemKey === normalizeKey("Corrosion Protection / Cavity Wax") && documented.has(normalizeKey("Cavity wax"))) ||
    (itemKey === normalizeKey("Corrosion Protection / Weld Restoration") && documented.has(normalizeKey("Cavity wax")))
  ) {
    return true;
  }

  return false;
}

function sanitizeEvidence(value?: string | null): string | undefined {
  const cleaned = sanitizeReason(value, "").replace(/^evidence:\s*/i, "").trim();
  return cleaned || undefined;
}

function sanitizeSupplementEvidence(
  title: string,
  value?: string | null
): string | undefined {
  const cleaned = sanitizeEvidence(value);
  if (!cleaned) return undefined;

  if (title === "One-Time-Use Hardware / Seals / Clips") {
    const filtered = filterHardwareText(cleaned);
    return filtered && !looksLikeNoisySupplementText(filtered) ? filtered : undefined;
  }

  if (title === "Seam Sealer Restoration") {
    const filtered = filterSeamSealerText(cleaned);
    return filtered && !looksLikeNoisySupplementText(filtered) ? filtered : undefined;
  }

  if (title === "ADAS / Calibration Procedure Support") {
    if (looksLikeNoisySupplementText(cleaned) || !looksCalibrationFocused(cleaned)) {
      return undefined;
    }
  }

  if (title === "Headlamp aiming check") {
    if (looksLikeNoisySupplementText(cleaned) || !looksHeadlampAimFocused(cleaned)) {
      return undefined;
    }
  }

  return cleaned;
}

function polishSourceLabel(value?: string | null): string | undefined {
  const raw = sanitizeReason(value, "").trim();
  if (!raw) return undefined;

  if (/seam sealer/i.test(raw)) {
    return /oem/i.test(raw) ? "OEM procedure support" : "File review";
  }

  if (
    /function not clearly represented in estimate|not clearly represented in estimate|not clearly documented in the current estimate|not clearly documented in the current material/i.test(
      raw
    )
  ) {
    if (/oem/i.test(raw)) return "OEM procedure support";
    if (/estimate|attachment|document/i.test(raw)) return "Estimate text";
    if (/narrative/i.test(raw)) return "File review";
    return "File review";
  }

  const cleaned = raw
    .replace(/\bdecision panel\b/gi, "File review")
    .replace(/\bmissing procedure list\b/gi, "Missing procedures")
    .replace(/\bsupplement opportunity\b/gi, "Repair review")
    .replace(/\bstructured narrative\b/gi, "File review")
    .replace(/\bassistant reasoning\b/gi, "File review")
    .replace(/\bline mapping(?: engine)?\b/gi, "File review")
    .replace(/\bhybrid supplement(?: flow)?\b/gi, "Repair review")
    .replace(/\battachment\b/gi, "Estimate text")
    .replace(/\bdocumentation\b/gi, "Documentation")
    .replace(/\bparts\b/gi, "Parts analysis")
    .replace(/\bscan\b/gi, "Scan analysis")
    .replace(/\bcalibration\b/gi, "Calibration analysis")
    .replace(/\s{2,}/g, " ")
    .trim();

  return cleaned || undefined;
}

function cleanFormalExportText(value?: string | null): string {
  const cleaned = cleanDisplayText(value);

  if (!cleaned) return "";

  return cleaned
    .replace(/\bBottom line:\s*/gi, "")
    .replace(/\bStructured analysis\b/gi, "File review")
    .replace(/\bSupplement analysis\b/gi, "Repair review")
    .replace(/\bNarrative synthesis\b/gi, "File review")
    .replace(/\bStructured narrative\b/gi, "File review")
    .replace(/\bcurrent normalized repair analysis\b/gi, "current repair file")
    .replace(/\bexport model\b/gi, "supporting documentation")
    .replace(/\bfunction not clearly represented\b/gi, "not clearly documented")
    .replace(/\bthe current material does not clearly document\b/gi, "the file does not clearly support")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function sanitizeSupplementReason(
  title: string,
  value?: string | null,
  fallback?: string
): string {
  const cleaned = sanitizeReason(value, fallback);

  if (title === "One-Time-Use Hardware / Seals / Clips") {
    const filtered = filterHardwareText(cleaned);
    return (
      (filtered && !looksLikeNoisySupplementText(filtered) ? filtered : "") ||
      "The repair path supports replacement of one-time-use hardware, seals, or clips, but that replacement burden is not clearly documented in the current estimate."
    );
  }

  if (title === "ADAS / Calibration Procedure Support") {
    const normalized = normalizeSupplementText(cleaned);
    if (!normalized || looksLikeNoisySupplementText(normalized)) {
      return "The repair path supports required ADAS, scan, and calibration procedures, but the current estimate does not clearly document the needed verification steps.";
    }

    return normalizeCalibrationReason(normalized);
  }

  if (title === "Headlamp aiming check") {
    const normalized = normalizeSupplementText(cleaned);
    if (!normalized || looksLikeNoisySupplementText(normalized)) {
      return "The repair path supports a headlamp aiming check after lamp or front-end service, but the current estimate does not clearly document that verification step.";
    }

    return normalizeHeadlampAimReason(normalized);
  }

  if (title === "Seam Sealer Restoration") {
    const withoutRefinishGlossary = filterSeamSealerText(cleaned);

    return (
      (withoutRefinishGlossary && !looksLikeNoisySupplementText(withoutRefinishGlossary)
        ? withoutRefinishGlossary
        : "") ||
      "Please provide seam sealer restoration details for the affected areas, along with supporting repair-process or OEM documentation."
    );
  }

  return cleaned;
}

function filterHardwareText(value: string): string {
  const filtered = value
    .replace(/\bcolor coat application\b/gi, "")
    .replace(/\bbagging\b/gi, "")
    .replace(/\bclear coat finishes?\b/gi, "")
    .replace(/\bthree-stage finishes?\b/gi, "")
    .replace(/\bthree stage finishes?\b/gi, "")
    .replace(/\bcolor blend\b/gi, "")
    .replace(/\bblend(?:ing)?\b/gi, "")
    .replace(/\bbasecoat\b/gi, "")
    .replace(/\bclearcoat\b/gi, "")
    .replace(/\brefinish(?:ing)?\b/gi, "")
    .replace(/\bpaint glossary\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/(?:,\s*){2,}/g, ", ")
    .replace(/^[,;:\s-]+|[,;:\s-]+$/g, "")
    .trim();

  if (!filtered) {
    return "";
  }

  if (!looksHardwareFocused(filtered)) {
    return "";
  }

  return filtered;
}

function filterSeamSealerText(value: string): string {
  const filtered = value
    .replace(/\bcolor coat application\b/gi, "")
    .replace(/\bbagging\b/gi, "")
    .replace(/\bthree-stage finishes?\b/gi, "")
    .replace(/\bthree stage finishes?\b/gi, "")
    .replace(/\bcolor blend\b/gi, "")
    .replace(/\bblend(?:ing)?\b/gi, "")
    .replace(/\bbasecoat\b/gi, "")
    .replace(/\bclearcoat\b/gi, "")
    .replace(/\brefinish(?:ing)?\b/gi, "")
    .replace(/\bpaint glossary\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/(?:,\s*){2,}/g, ", ")
    .replace(/^[,;:\s-]+|[,;:\s-]+$/g, "")
    .trim();

  if (!filtered) {
    return "";
  }

  if (!looksSeamSealerFocused(filtered)) {
    return "";
  }

  return filtered;
}

function normalizeSupplementText(value: string): string {
  return value
    .replace(/\blamp assy\b/gi, "headlamp assembly")
    .replace(/\bassy\b/gi, "assembly")
    .replace(/\bfrt\b/gi, "front")
    .replace(/\brr\b/gi, "rear")
    .replace(/\blh\b/gi, "left")
    .replace(/\brh\b/gi, "right")
    .replace(/\bheadlight\b/gi, "headlamp")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeCalibrationReason(value: string): string {
  const normalized = normalizeSupplementText(value);
  if (looksCalibrationFocused(normalized) && !looksLikeNoisySupplementText(normalized)) {
    return normalized
      .replace(/\bcalibration analysis\b/gi, "calibration")
      .replace(/\bscan analysis\b/gi, "scan support");
  }

  return "The repair path supports required ADAS, scan, and calibration procedures, but the current estimate does not clearly document the needed verification steps.";
}

function normalizeHeadlampAimReason(value: string): string {
  const normalized = normalizeSupplementText(value);
  if (looksHeadlampAimFocused(normalized) && !looksLikeNoisySupplementText(normalized)) {
    return normalized;
  }

  return "The repair path supports a headlamp aiming check after lamp or front-end service, but the current estimate does not clearly document that verification step.";
}

function looksLikeNoisySupplementText(value: string): boolean {
  const lower = value.toLowerCase();
  const codeMatches = (lower.match(/\b(r&i|rpr|repl|blnd|refn|sublet|nags|op|incl|w\/|w\/o|lt|rt|lh|rh|assy)\b/g) ?? []).length;
  const punctuationDensity = (lower.match(/[|/]/g) ?? []).length;
  const numberCodeDensity = (lower.match(/\b\d{2,}\b/g) ?? []).length;
  const glossaryHits = (lower.match(/\b(color coat|bagging|three-stage|three stage|blend|basecoat|clearcoat)\b/g) ?? []).length;

  return codeMatches >= 3 || punctuationDensity >= 3 || numberCodeDensity >= 4 || glossaryHits >= 2;
}

function looksCalibrationFocused(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.includes("adas") ||
    lower.includes("calibration") ||
    lower.includes("scan") ||
    lower.includes("camera") ||
    lower.includes("radar") ||
    lower.includes("sensor") ||
    lower.includes("verification")
  );
}

function looksHeadlampAimFocused(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    (lower.includes("headlamp") || lower.includes("lamp")) &&
    (lower.includes("aim") || lower.includes("alignment") || lower.includes("verification"))
  );
}

function looksSeamSealerFocused(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.includes("seam sealer") ||
    lower.includes("joint sealing") ||
    lower.includes("sealer") ||
    lower.includes("corrosion") ||
    lower.includes("cavity wax") ||
    lower.includes("weld protection")
  );
}

function looksHardwareFocused(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.includes("one-time-use") ||
    lower.includes("one time use") ||
    lower.includes("hardware") ||
    lower.includes("clip") ||
    lower.includes("seal") ||
    lower.includes("fastener") ||
    lower.includes("retainer")
  );
}

function pickPreferredDetail(left?: string, right?: string): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return scoreDisplayDetail(right) > scoreDisplayDetail(left) ? right : left;
}

function scoreDisplayDetail(value: string): number {
  const lower = value.toLowerCase();
  let score = value.length;
  if (lower.includes("pipeline evidence")) score -= 15;
  if (lower.includes("repair-pipeline")) score -= 15;
  if (lower.includes("structured analysis")) score += 10;
  if (lower.includes("oem")) score += 20;
  if (lower.includes("procedure")) score += 12;
  return score;
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
  if (item.category === "structural") score += 60;
  if (item.category === "material") score += 80;
  if (
    lower.includes("front structure") ||
    lower.includes("tie bar") ||
    lower.includes("lock support") ||
    lower.includes("support area") ||
    lower.includes("upper rail") ||
    lower.includes("core support")
  ) score += 15;
  if (lower.includes("setup") || lower.includes("measure") || lower.includes("realignment")) score += 110;
  if (lower.includes("replace vs repair") || lower.includes("repair vs replace")) score += 105;
  if (lower.includes("fit-sensitive") || lower.includes("fit sensitive")) score += 100;
  if (lower.includes("adas") || lower.includes("calibration procedure support")) score += 95;
  if (lower.includes("test fit")) score += 100;
  if (lower.includes("coolant") || lower.includes("bleed") || lower.includes("refill")) score += 95;
  if (lower.includes("hardware") || lower.includes("seal") || lower.includes("clip") || lower.includes("fastener")) score += 92;
  if (lower.includes("mounting geometry") || lower.includes("teardown") || lower.includes("hidden")) score += 120;
  if (lower.includes("corrosion") || lower.includes("cavity wax") || lower.includes("seam sealer") || lower.includes("weld protection")) score += 90;
  if (lower.includes("alignment")) score += 110;
  if (lower.includes("scan") || lower.includes("calibration")) score += 50;
  if (looksLikeMetaCommentary(lower)) score -= 400;
  if (lower.includes("not documented") || lower.includes("not clearly") || lower.includes("underwritten")) score += 40;
  if (lower.includes("front structure scope / tie bar / upper rail reconciliation")) score -= 80;
  score += Math.min(item.rationale.length, 100);
  return score;
}

function selectConsistentSupplementItems(
  items: ExportSupplementItem[],
  limit = 6
): ExportSupplementItem[] {
  if (items.length <= limit) {
    return items;
  }

  const narrowFocus = new Set([
    "ADAS / Calibration Procedure Support",
    "Headlamp aiming check",
    "Seam Sealer Restoration",
  ]);

  const primary = items.filter((item) => !narrowFocus.has(item.title)).slice(0, Math.max(1, limit - 1));
  const fallback = items.filter((item) => narrowFocus.has(item.title)).slice(0, limit - primary.length);
  return [...primary, ...fallback].slice(0, limit);
}

function buildRequestHeading(items: ExportSupplementItem[]): string {
  const hasOnlyRefinishItems = items.length > 0 && items.every((item) => isRefinishSupportItem(item.title));
  const kinds = new Set(items.map((item) => item.kind));
  if (hasOnlyRefinishItems) {
    return "Please review the following refinish-related items and provide the procedure, blend, material, or paint-process support carrying the current position:";
  }
  if (kinds.has("missing_operation")) {
    return "Please review the following operations and provide support if they remain part of the intended repair plan:";
  }
  if (kinds.has("missing_verification")) {
    return "Please review the following verification items and provide the supporting procedure path, measurements, scans, calibrations, or related records where available:";
  }
  if (kinds.has("underwritten_operation")) {
    return "Please review the following items and provide the support, time justification, or related documentation carrying the current position:";
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
    case "Tint Color / Let-Down Panel":
      return "Please provide the tint, let-down, or color-match rationale supporting this refinish step, including the paint-process support carrying the current position.";
    case "Finish Sand and Polish":
      return "Please provide the finish sand, denib, color-sand-and-buff, or final-finish rationale supporting this refinish step.";
    case "Masking / Edge Prep":
      return "Please provide the masking, edge-prep, or related paint-process rationale supporting this refinish step.";
    case "Three-Stage Refinish Operation":
      return "Please provide the three-stage refinish rationale, including the paint-process and material support carrying this operation.";
    case "Flex Additive":
      return "Please provide the flex-additive rationale and any supporting paint-process documentation carrying this refinish operation.";
    case "Blend / Blend Within Panel":
      return "Please provide the blend rationale and related paint-process support for this refinish operation.";
    case "Structural Measurement Verification":
      return "Please provide the documented dimensional measurement or verification support for this repair path, including how geometry confirmation was performed.";
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
    case "Headlamp aiming check":
      return "Please provide the headlamp aiming procedure support for this repair path, including how final aim verification was to be performed.";
    case "Four-Wheel Alignment":
      return "Please provide the alignment rationale and any related post-repair documentation supporting this operation.";
    case "Pre-Paint Test Fit":
      return "Please provide the rationale for the pre-paint test fit burden and how final fit was to be confirmed before finish work.";
    case "Seam Sealer Restoration":
      return "Please provide seam sealer restoration details for the affected areas, along with supporting repair-process or OEM documentation.";
    case "Corrosion Protection / Weld Restoration":
      return "Please provide the corrosion-protection, cavity-wax, seam, or weld-restoration documentation supporting this repair path.";
    case "Coolant Fill and Bleed":
      return "Please provide the support for the coolant refill, bleed, or related access burden associated with this repair path.";
    default:
      return makeRequestLineFromReason(reason);
  }
}

function makeRequestLineFromReason(reason: string): string {
  const trimmed = trimTrailingPunctuation(reason);
  if (!trimmed) {
    return "Please provide the supporting rationale or documentation for this item.";
  }

  return `Please provide the supporting rationale or documentation for this item: ${trimmed}.`;
}

function isRefinishSupportItem(value?: string): boolean {
  const lower = (value ?? "").toLowerCase();
  return (
    lower.includes("refinish") ||
    lower.includes("blend") ||
    lower.includes("tint") ||
    lower.includes("let-down") ||
    lower.includes("let down") ||
    lower.includes("color sand") ||
    lower.includes("denib") ||
    lower.includes("polish") ||
    lower.includes("masking") ||
    lower.includes("edge prep") ||
    lower.includes("flex additive")
  );
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
      source: "Structured narrative",
      priority,
    });
  };

  if (text.includes("test fit") || text.includes("fit-check") || text.includes("fit check")) {
    add(
      "Pre-Paint Test Fit",
      "Test-fit or fit-check burden appears supportable for adjacent front-end panels before final finish work.",
      "high",
      "underwritten_operation"
    );
  }

  if (text.includes("frame bench") || text.includes("setup") || text.includes("measuring") || text.includes("realignment")) {
    add(
      "Structural Measurement Verification",
      "Documented measurements or structural verification appear supportable here, but that verification item is not clearly documented in the current estimate.",
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
    if (/(not clearly|underwritten|not documented|unclear)/.test(text)) {
      add(
        "Front Structure Scope / Tie Bar / Upper Rail Reconciliation",
        "Front-structure, tie-bar, lock-support, radiator-support, or adjacent support-area scope appears broader than the current estimate reflects.",
        "high",
        "disputed_repair_path"
      );
    }
  }

  if (
    (text.includes("corrosion protection") || text.includes("weld protection") || text.includes("masking")) &&
    /(not clearly|underwritten|not documented|unclear|missing)/.test(text)
  ) {
    add(
      "Corrosion Protection / Weld Restoration",
      "Corrosion protection, cavity wax, weld protection, or related restoration steps appear supportable here, but they are not clearly documented in the current estimate.",
      "medium",
      "underwritten_operation"
    );
  }

  if (text.includes("refrigerant")) {
    add(
      "Refrigerant Recover / Recharge",
      "Refrigerant handling appears supportable here, but that process burden is not clearly documented in the current estimate.",
      "medium",
      "underwritten_operation"
    );
  }

  if (text.includes("coolant") || text.includes("air purge") || text.includes("bleed")) {
    add(
      "Coolant Fill and Bleed",
      "Coolant refill, bleed, or air-purge work appears supportable here, but that operation is not clearly documented in the current estimate.",
      "medium",
      "underwritten_operation"
    );
  }

  if (text.includes("teardown") || text.includes("mounting geometry") || text.includes("hidden damage")) {
    add(
      "Hidden Mounting Geometry / Teardown Growth",
      "Teardown growth or hidden mounting-geometry burden appears supportable here, but that front-end scope is not fully reflected in the current estimate.",
      "high",
      "disputed_repair_path"
    );
  }

  if (text.includes("clip") || text.includes("seal") || text.includes("one-time-use") || text.includes("one time use") || text.includes("fastener")) {
    add(
      "One-Time-Use Hardware / Seals / Clips",
      "Replacement of hardware, seals, clips, or other one-time-use items appears supportable here, but that replacement burden is not clearly documented in the current estimate.",
      "medium",
      "underwritten_operation"
    );
  }

  if (text.includes("battery disconnect") || text.includes("battery reset") || text.includes("reset considerations")) {
    add(
      "Battery Disconnect / Reset Considerations",
      "Battery disconnect or reset considerations appear relevant here, but that process item is not clearly documented in the current estimate.",
      "medium",
      "missing_verification"
    );
  }

  if (text.includes("alignment")) {
    add(
      "Four-Wheel Alignment",
      "Alignment appears supportable for this repair path, but that operation is not clearly documented in the current estimate.",
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
    .replace(
      /(?:^|\n)\s*(?:what looks reasonable|what still needs support|what looks aggressive|what stands out|documented positives|likely remaining gaps|support posture|estimate position)\s*:\s*(?=\n|$)/gim,
      "\n"
    )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!cleaned || looksLikeEstimateNoise(cleaned)) {
    return null;
  }

  if (/upload an estimate or supporting documents to generate a real repair intelligence read/i.test(cleaned)) {
    return null;
  }

  return cleaned;
}

function looksLikeYearOnlyVehicleLabel(value?: string | null): boolean {
  if (!value) return false;
  return /^(19|20)\d{2}$/.test(value.trim());
}

function looksLikeWeakVehicleIdentityLabel(value?: string | null): boolean {
  if (!value) return false;

  const cleaned = cleanDisplayText(value);
  if (!cleaned || looksLikeYearOnlyVehicleLabel(cleaned)) {
    return true;
  }

  const tokens = cleaned
    .split(/\s+/)
    .map((token: string) => token.trim())
    .filter(Boolean);
  const nonYearTokens = tokens.filter((token: string) => !/^(19|20)\d{2}$/.test(token));

  return nonYearTokens.length < 2;
}

function cleanPresentationProse(value?: string | null): string {
  const cleaned = cleanDisplayText(value);
  if (!cleaned) return "";

  const withoutEmptyStubs = cleaned
    .replace(
      /\b(?:What looks reasonable|What still needs support|What looks aggressive|What stands out|Documented positives|Likely remaining gaps|Support posture|Estimate position):\s*/gi,
      ""
    )
    .replace(
      /(?:^|[\s.])Areas that look aggressive or likely to get pushback\s*:?\s*(?:\.)?(?=\s|$)/gi,
      " "
    )
    .trim();
  if (!withoutEmptyStubs) return "";

  const withoutInlineEnumeration = withoutEmptyStubs.replace(INLINE_ENUMERATION_PATTERN, "$1").trim();
  const detailBlockMatch = withoutInlineEnumeration.match(PRESENTATION_DETAIL_BLOCK_PATTERN);
  const beforeDetailBlock = detailBlockMatch
    ? withoutInlineEnumeration.slice(0, detailBlockMatch.index).trim()
    : withoutInlineEnumeration;

  const collapsed = beforeDetailBlock
    .split("\n")
    .map((line: string) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();

  return removeNearDuplicateConclusionSentences(trimTrailingPunctuation(collapsed) + (collapsed ? "." : ""));
}

function makeRepairPositionTail(value: string): string | null {
  const cleaned = sanitizeNarrative(value);
  if (!cleaned) return null;

  const lower = cleaned.toLowerCase();
  if (
    lower.includes("the shop estimate appears materially more complete") ||
    lower.includes("the carrier estimate remains materially underwritten") ||
    lower.includes("credible preliminary repair plan") ||
    lower.includes("not obviously padded") ||
    lower.includes("likely incomplete in measuring") ||
    lower.includes("likely to grow after teardown")
  ) {
    return null;
  }

  return trimTrailingPunctuation(cleaned);
}

function removeNearDuplicateConclusionSentences(value: string): string {
  const sentences = value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const kept: string[] = [];
  const seenConcepts = new Set<string>();

  for (const sentence of sentences) {
    const concept = normalizeConclusionConcept(sentence);
    if (concept && seenConcepts.has(concept)) {
      continue;
    }
    if (concept) {
      seenConcepts.add(concept);
    }
    kept.push(sentence);
  }

  return kept.join(" ").trim();
}

function normalizeConclusionConcept(value: string): string | null {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (
    normalized.includes("credible preliminary") ||
    normalized.includes("likely to grow after teardown") ||
    normalized.includes("not obviously padded") ||
    normalized.includes("likely incomplete in measuring") ||
    normalized.includes("alignment") && normalized.includes("hidden damage")
  ) {
    return "single_estimate_conclusion";
  }

  return null;
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
    lower.includes("cooling") ||
    lower.includes("coolant") ||
    lower.includes("bleed") ||
    lower.includes("purge") ||
    lower.includes("hardware") ||
    lower.includes("one-time-use") ||
    lower.includes("one time use") ||
    lower.includes("fastener") ||
    lower.includes("clip") ||
    lower.includes("seal") ||
    lower.includes("seam") ||
    lower.includes("corrosion") ||
    lower.includes("primer") ||
    lower.includes("wax") ||
    lower.includes("refinish") ||
    lower.includes("blend") ||
    lower.includes("tint") ||
    lower.includes("let-down") ||
    lower.includes("let down") ||
    lower.includes("denib") ||
    lower.includes("color sand") ||
    lower.includes("polish") ||
    lower.includes("masking") ||
    lower.includes("edge prep") ||
    lower.includes("flex additive") ||
    lower.includes("tie bar") ||
    lower.includes("lock support") ||
    lower.includes("core support") ||
    lower.includes("support area") ||
    lower.includes("sidemember") ||
    lower.includes("mounting geometry") ||
    lower.includes("teardown") ||
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
