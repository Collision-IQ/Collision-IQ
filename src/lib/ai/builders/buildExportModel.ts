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
import {
  isVehicleContentApplicable,
  resolveVehicleApplicabilityContext,
  sanitizeVehicleSpecificText,
} from "../vehicleApplicability";

export const COLLISION_ACADEMY_HANDOFF_URL = "https://www.collision.academy/";
export const REDACTED_INSURER_TOKEN = "[REDACTED_INSURER]";
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

export type ExportValuationPreviewSummary = {
  acv: string;
  dv: string;
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

export type ComparableListing = {
  price?: number;
  askingPrice?: number;
  mileage?: number;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  source?: string;
  title?: string;
};

export type JDPowerValuation = {
  average?: number;
  low?: number;
  high?: number;
  cleanTradeIn?: number;
  cleanRetail?: number;
  source?: string;
};

export type StructuredValuationData = {
  comparableListings?: ComparableListing[];
  jdPower?: JDPowerValuation;
};

export type ComputedAcvResult = {
  acvRange: { low: number; high: number };
  acvValue: number;
  confidence: "low" | "medium" | "high";
  compCount: number;
  sourceType: "comps" | "jd_power";
  reasoning: string;
};

const ESTIMATE_TOTAL_ACV_FALLBACK_LOW_OFFSET = 3500;
const ESTIMATE_TOTAL_ACV_FALLBACK_HIGH_OFFSET = 2500;
const DV_FALLBACK_RANGE = { low: 500, high: 2500 } as const;

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
  const reportFields = deriveExportReportFields({
    report: params.report,
    analysis: params.analysis,
  });
  const sourceEstimateText = collectVehicleDocumentText(params.report, params.analysis);
  const estimateFacts = reportFields.estimateFacts;
  const vehicleApplicability = resolveVehicleApplicabilityContext(
    reportFields.vehicle,
    params.report?.vehicle,
    params.report?.analysis?.vehicle,
    params.analysis?.vehicle,
    estimateFacts.vehicle
  );
  const chatInsights = deriveRenderInsightsFromChat(params.assistantAnalysis ?? "", vehicleApplicability);
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
    estimateFacts,
    vehicleApplicability
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
  const valuation = buildValuation(
    params.panel,
    chatInsights.valuation,
    reportFields,
    params.report,
    params.analysis
  );
  const displayVehicle = getDisplayVehicleInfo(vehicle);
  const allowUnsupportedSeamSealerNarrative =
    hasExplicitSeamSealerSupport(sourceEstimateText) ||
    supplementItems.some((item) => item.title === "Seam Sealer Restoration");
  const cleanedSupplementItems = supplementItems.map((item) => ({
    ...item,
    title: cleanDisplayLabel(item.title),
    rationale: cleanFormalExportText(
      stripUnsupportedSeamSealerLanguage(
        item.rationale,
        sourceEstimateText,
        allowUnsupportedSeamSealerNarrative
      )
    ),
    evidence: item.evidence
      ? cleanFormalExportText(
          stripUnsupportedSeamSealerLanguage(
            item.evidence,
            sourceEstimateText,
            allowUnsupportedSeamSealerNarrative
          )
        )
      : undefined,
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
    [
      vehicle?.year,
      cleanDisplayLabel(vehicle?.make),
      cleanDisplayLabel(vehicle?.model),
      cleanVehicleDescriptor(displayVehicle.trim),
    ]
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
    trim: cleanVehicleDescriptor(displayVehicle.trim ?? vehicle.trim),
    vin: reportFields.vin ?? vehicle.vin,
    make: cleanDisplayLabel(vehicle.make),
    model: cleanDisplayLabel(vehicle.model),
    manufacturer: cleanVehicleDescriptor(vehicle.manufacturer),
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
      : cleanFormalExportText(
          stripUnsupportedSeamSealerLanguage(
            sanitizeVehicleSpecificText(
              cleanPresentationProse(repairPosition),
              vehicleApplicability
            ),
            sourceEstimateText,
            allowUnsupportedSeamSealerNarrative
          )
        ),
    positionStatement: allLabelsSuppressed
      ? "The main dispute areas remain supportable, but low-quality extracted labels were removed before rendering."
      : cleanFormalExportText(
          stripUnsupportedSeamSealerLanguage(
            sanitizeVehicleSpecificText(
              cleanPresentationProse(positionStatement),
              vehicleApplicability
            ),
            sourceEstimateText,
            allowUnsupportedSeamSealerNarrative
          )
        ),
    supplementItems: guardedSupplementItems,
    request: allLabelsSuppressed
      ? "Please review the core dispute areas and provide clearer support for the intended repair path and verification steps."
      : cleanFormalExportText(
          stripUnsupportedSeamSealerLanguage(
            sanitizeVehicleSpecificText(request, vehicleApplicability),
            sourceEstimateText,
            allowUnsupportedSeamSealerNarrative
          )
        ),
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
      cleanVehicleDescriptor(normalized.trim),
    ]
      .filter(Boolean)
      .join(" ")
  );
}

export function buildExportValuationPreviewSummary(
  valuation: DerivedValuation
): ExportValuationPreviewSummary {
  return {
    acv: summarizeExportValuationBand({
      label: "ACV preview",
      status: valuation.acvStatus,
      value: valuation.acvValue,
      range: valuation.acvRange,
      maxRange: 250000,
    }),
    dv: summarizeExportValuationBand({
      label: "DV preview",
      status: valuation.dvStatus,
      value: valuation.dvValue,
      range: valuation.dvRange,
      maxRange: 50000,
    }),
  };
}

function sanitizeVehicleDisplay(value?: string | null): string | undefined {
  if (!value) return undefined;
  const cleaned = cleanVehicleDescriptor(value);
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
    cleanVehicleDescriptor(vehicle.trim),
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
    cleanVehicleDescriptor(vehicle.manufacturer),
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
          cleanVehicleDescriptor(vehicle?.trim),
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

function cleanVehicleDescriptor(value?: string | null): string | undefined {
  if (!value) return undefined;

  const cleaned = stripVehicleRoleNoise(cleanDisplayText(value))
    .replace(/\b4d sedan\b/gi, "4-door sedan")
    .replace(/\b4 door sedan\b/gi, "4-door sedan")
    .replace(/\butv\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[,\s-]+|[,\s-]+$/g, "")
    .trim();

  return cleaned || undefined;
}

function stripVehicleRoleNoise(value: string): string {
  return value
    .replace(
      /(?:,\s*|\s+)(?:insured|owner|claimant|customer|policyholder|adjuster|appraiser)\b/gi,
      ""
    )
    .replace(
      /\b(?:insured|owner|claimant|customer|policyholder|adjuster|appraiser)\b\s*,?/gi,
      ""
    )
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ", ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[,\s-]+|[,\s-]+$/g, "")
    .trim();
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

export function redactExportModelForDownload(exportModel: ExportModel): ExportModel {
  const insurer = resolveCanonicalInsurer(exportModel);
  if (!insurer || insurer === REDACTED_INSURER_TOKEN) {
    return exportModel;
  }

  return {
    ...exportModel,
    estimateFacts: {
      ...exportModel.estimateFacts,
      insurer: REDACTED_INSURER_TOKEN,
    },
    reportFields: {
      ...exportModel.reportFields,
      insurer: REDACTED_INSURER_TOKEN,
      documentedHighlights: exportModel.reportFields.documentedHighlights.map((item) =>
        redactInsurerInText(item, insurer)
      ),
      documentedProcedures: exportModel.reportFields.documentedProcedures.map((item) =>
        redactInsurerInText(item, insurer)
      ),
      presentStrengths: exportModel.reportFields.presentStrengths.map((item) =>
        redactInsurerInText(item, insurer)
      ),
      likelySupplementAreas: exportModel.reportFields.likelySupplementAreas.map((item) =>
        redactInsurerInText(item, insurer)
      ),
      estimateFacts: {
        ...exportModel.reportFields.estimateFacts,
        insurer: REDACTED_INSURER_TOKEN,
        documentedHighlights: exportModel.reportFields.estimateFacts.documentedHighlights.map((item) =>
          redactInsurerInText(item, insurer)
        ),
        documentedProcedures: exportModel.reportFields.estimateFacts.documentedProcedures.map((item) =>
          redactInsurerInText(item, insurer)
        ),
      },
    },
    repairPosition: redactInsurerInText(exportModel.repairPosition, insurer),
    positionStatement: redactInsurerInText(exportModel.positionStatement, insurer),
    request: redactInsurerInText(exportModel.request, insurer),
    supplementItems: exportModel.supplementItems.map((item) => ({
      ...item,
      title: redactInsurerInText(item.title, insurer),
      rationale: redactInsurerInText(item.rationale, insurer),
      evidence: item.evidence ? redactInsurerInText(item.evidence, insurer) : undefined,
      source: item.source ? redactInsurerInText(item.source, insurer) : undefined,
    })),
    valuation: {
      ...exportModel.valuation,
      acvReasoning: redactInsurerInText(exportModel.valuation.acvReasoning, insurer),
      acvMissingInputs: exportModel.valuation.acvMissingInputs.map((item) =>
        redactInsurerInText(item, insurer)
      ),
      dvReasoning: redactInsurerInText(exportModel.valuation.dvReasoning, insurer),
      dvMissingInputs: exportModel.valuation.dvMissingInputs.map((item) =>
        redactInsurerInText(item, insurer)
      ),
    },
  };
}

function sanitizeCanonicalField(value?: string | null): string | undefined {
  if (!value) return undefined;
  const cleaned = cleanVehicleDescriptor(value) ?? cleanDisplayText(value);
  if (!cleaned) return undefined;
  if (GENERIC_PLACEHOLDER_FIELD_PATTERN.test(cleaned)) return undefined;
  return cleaned;
}

function redactInsurerInText(value: string, insurer: string): string {
  if (!value || !insurer || value.includes(REDACTED_INSURER_TOKEN)) {
    return value;
  }

  const pattern = new RegExp(`(?<!\\w)${escapeRegex(insurer)}(?:'s)?(?!\\w)`, "gi");
  return value.replace(pattern, (match) =>
    /'s$/i.test(match) ? `${REDACTED_INSURER_TOKEN}'s` : REDACTED_INSURER_TOKEN
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
            summarizeVisibleScope(story.zones, story.panels, sourceEstimateText ?? ""),
          ].filter((value): value is string => Boolean(value))
        )}.`
      : "";

  return `${factLead}${scopeLead}${strengthsLead} The file supports a grounded preliminary review, while some repair or documentation items may become clearer as teardown progresses.`;
}

function summarizeVisibleScope(
  zones: string[],
  panels: string[],
  sourceEstimateText: string
): string | undefined {
  const normalizedZones = zones.filter(Boolean);
  const normalizedPanels = panels.map((panel) => panel.toLowerCase()).filter(Boolean);
  const panelText = normalizedPanels.join(" ");
  const lowerSource = sourceEstimateText.toLowerCase();
  const zoneSet = new Set(normalizedZones);

  const leftRearSignal =
    /(left rear|rear left|left quarter|quarter|left side)/i.test(panelText) ||
    /(left rear|rear left|left quarter|quarter panel|left side|left rocker|left dog leg)/i.test(
      lowerSource
    );
  const leftFrontSignal =
    /(left front|left fender|left headlamp)/i.test(panelText) ||
    /(left front|left fender|left headlamp|lf\b|driver side front)/i.test(lowerSource);
  const rightFrontSignal =
    /(right front|right fender|right headlamp)/i.test(panelText) ||
    /(right front|right fender|right headlamp|rf\b|passenger side front)/i.test(lowerSource);

  if (leftRearSignal) {
    const supportedZones = normalizedZones.filter(
      (zone) => zone === "rear body" || zone === "side structure"
    );
    if (supportedZones.length > 0) {
      return `${joinHumanList(supportedZones)} around the left-rear / left-side repair area`;
    }
    return "left-rear / left-side areas";
  }

  if (leftFrontSignal && !rightFrontSignal) {
    const frontLikeZones = normalizedZones.filter(
      (zone) => zone === "front-end" || zone === "side structure"
    );
    if (frontLikeZones.length > 0) {
      return `${joinHumanList(frontLikeZones)} around the left-front / left-side repair area`;
    }
    return "left-front / left-side areas";
  }

  if (rightFrontSignal && !leftFrontSignal && !leftRearSignal) {
    const frontLikeZones = normalizedZones.filter(
      (zone) => zone === "front-end" || zone === "side structure"
    );
    if (frontLikeZones.length > 0) {
      return `${joinHumanList(frontLikeZones)} around the right-front repair area`;
    }
    return "right-front areas";
  }

  if (zoneSet.has("front-end") && (zoneSet.has("side structure") || zoneSet.has("rear body"))) {
    const nonFrontZones = normalizedZones.filter((zone) => zone !== "front-end");
    if (nonFrontZones.length > 0) {
      return `${joinHumanList(nonFrontZones)} areas`;
    }
  }

  if (normalizedZones.length > 0) {
    return `${joinHumanList(normalizedZones)} areas`;
  }

  if (panels.length > 0) {
    return `${panels.length} noted panel${panels.length === 1 ? "" : "s"}`;
  }

  return undefined;
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
  estimateFacts: EstimateFacts,
  vehicleApplicability = resolveVehicleApplicabilityContext(
    report?.vehicle,
    report?.analysis?.vehicle,
    analysis?.vehicle,
    estimateFacts.vehicle
  )
): ExportSupplementItem[] {
  const defaultRationale = "This operation appears supportable but is not yet carried clearly in the current estimate.";
  const sourceText = collectVehicleDocumentText(report, analysis);
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
      source: polishSourceLabel(item.raw) ?? polishSourceLabel("Supplement opportunity"),
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
  ].map((item) => ({
    ...item,
    rationale: sanitizeVehicleSpecificText(item.rationale, vehicleApplicability),
    evidence: item.evidence ? sanitizeVehicleSpecificText(item.evidence, vehicleApplicability) : undefined,
    source: item.source ? sanitizeVehicleSpecificText(item.source, vehicleApplicability) : undefined,
  }))
    .filter((item) =>
      isVehicleContentApplicable(
        `${item.title} ${item.rationale} ${item.evidence ?? ""} ${item.source ?? ""}`,
        vehicleApplicability
      )
    )
    .filter((item) => Boolean(item.rationale.trim()));
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
  const curated = curateExportSupplementItems(filtered, sourceText);
  return curated.map((item) => ({
    ...item,
    category: inferSupplementCategory(item.title),
    rationale: trimTrailingPunctuation(item.rationale) + ".",
    evidence: item.evidence ? trimTrailingPunctuation(item.evidence) + "." : undefined,
  }));
}

function buildValuation(
  panel: DecisionPanel | null,
  chatValuation: DerivedValuation,
  reportFields: ExportReportFields,
  report: RepairIntelligenceReport | null,
  analysis: AnalysisResult | null
): DerivedValuation {
  const computedAcv = resolveComputedAcv({
    report,
    analysis,
    vehicle: reportFields.vehicle ?? estimateFactsToVehicle(reportFields.estimateFacts),
    mileage: reportFields.mileage,
  });
  const sanePanelDv = coerceSaneDvRange(panel?.diminishedValue?.low, panel?.diminishedValue?.high);
  const chatAcvPreviewRange = computedAcv
    ? computedAcv.acvRange
    : resolveValuationPreviewRange({
        status: normalizeAcvStatus(chatValuation),
        value: chatValuation.acvValue,
        range: isSaneRange(chatValuation.acvRange, 250000) ? chatValuation.acvRange : undefined,
        maxRange: 250000,
        minSpread: 1200,
        spreadRatio: 0.08,
      });
  const estimateTotalFallbackAcvRange = chatAcvPreviewRange
    ? undefined
    : resolveEstimateTotalAcvFallbackRange(reportFields.estimateTotal);
  const acvPreviewRange = chatAcvPreviewRange ?? estimateTotalFallbackAcvRange;
  const dvPreviewRange = resolveValuationPreviewRange({
    status:
      chatValuation.dvStatus === "provided" && typeof chatValuation.dvValue === "number"
        ? "provided"
        : chatValuation.dvStatus === "estimated_range" && isSaneRange(chatValuation.dvRange, 50000)
          ? "estimated_range"
          : sanePanelDv
            ? "estimated_range"
            : "not_determinable",
    value: chatValuation.dvValue,
    range:
      chatValuation.dvStatus === "estimated_range" && isSaneRange(chatValuation.dvRange, 50000)
        ? chatValuation.dvRange
        : sanePanelDv,
    maxRange: 50000,
    minSpread: 500,
    spreadRatio: 0.16,
  });
  const dvFallbackRange = dvPreviewRange
    ? undefined
    : resolveDirectionalDvFallbackRange({
        panel,
        reportFields,
        report,
        analysis,
      });
  const resolvedDvPreviewRange = dvPreviewRange ?? dvFallbackRange;

  const canonicalAcvMissingInputs =
    acvPreviewRange && !estimateTotalFallbackAcvRange
      ? []
      : scrubValuationMissingInputs(
          chatValuation.acvMissingInputs.length
            ? chatValuation.acvMissingInputs
            : ["vehicle condition", "mileage", "trim/options", "market comparable data"],
          reportFields
        );
  const dvStatus = resolvedDvPreviewRange ? "estimated_range" : "not_determinable";
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
    acvStatus: acvPreviewRange ? "estimated_range" : "not_determinable",
    acvValue: undefined,
    acvRange: acvPreviewRange,
    acvConfidence: computedAcv
      ? computedAcv.confidence
      : estimateTotalFallbackAcvRange
        ? "low"
      : normalizeValuationConfidence(
          acvPreviewRange ? "estimated_range" : "not_determinable",
          chatValuation.acvConfidence,
          canonicalAcvMissingInputs
        ),
    acvCompCount: computedAcv?.sourceType === "comps" ? computedAcv.compCount : undefined,
    acvSourceType: computedAcv?.sourceType ?? "fallback",
    acvReasoning: computedAcv
      ? `${computedAcv.reasoning} This remains a directional preview band, not a formal ACV appraisal.`
      : estimateTotalFallbackAcvRange
        ? `Directional preview only. No stronger market valuation support was preserved, so the current estimate total is being used as a rough anchor with a conservative fallback band of -$${ESTIMATE_TOTAL_ACV_FALLBACK_LOW_OFFSET.toLocaleString("en-US")} / +$${ESTIMATE_TOTAL_ACV_FALLBACK_HIGH_OFFSET.toLocaleString("en-US")}.`
      : acvPreviewRange
        ? sanitizeReason(
            chatValuation.acvReasoning,
            "This is a directional ACV preview band based on the current file set."
          ) || "This is a directional ACV preview band based on the current file set."
        : sanitizeReason(chatValuation.acvReasoning, "ACV preview is not supportable from the current documents.") ||
          "ACV preview is not supportable from the current documents.",
    acvMissingInputs: canonicalAcvMissingInputs,
    dvStatus,
    dvValue: undefined,
    dvRange: resolvedDvPreviewRange,
    dvConfidence: dvFallbackRange
      ? "low"
      : normalizeValuationConfidence(
          dvStatus,
          chatValuation.dvConfidence ?? normalizePanelDvConfidence(panel?.diminishedValue?.confidence),
          canonicalDvMissingInputs
        ),
    dvReasoning:
      dvFallbackRange
        ? "Directional preview only. The file shows enough repair-impact context to support a conservative diminished value preview band, but not a formal appraisal-grade DV conclusion."
      : resolvedDvPreviewRange
        ? sanitizeReason(
            chatValuation.dvReasoning ?? panel?.diminishedValue?.rationale,
            "This is a directional diminished value preview band based on the current file set."
          ) || "This is a directional diminished value preview band based on the current file set."
        : sanitizeReason(
            chatValuation.dvReasoning ?? panel?.diminishedValue?.rationale,
            "DV preview is not supportable from the current documents."
          ) || "DV preview is not supportable from the current documents.",
    dvMissingInputs: canonicalDvMissingInputs,
  };
}

function resolveEstimateTotalAcvFallbackRange(
  estimateTotal?: number
): { low: number; high: number } | undefined {
  if (typeof estimateTotal !== "number" || !Number.isFinite(estimateTotal) || estimateTotal <= 0) {
    return undefined;
  }

  const range = {
    low: Math.max(1, Math.round(estimateTotal - ESTIMATE_TOTAL_ACV_FALLBACK_LOW_OFFSET)),
    high: Math.round(estimateTotal + ESTIMATE_TOTAL_ACV_FALLBACK_HIGH_OFFSET),
  };

  return isSaneRange(range, 250000) ? range : undefined;
}

function resolveDirectionalDvFallbackRange(params: {
  panel: DecisionPanel | null;
  reportFields: ExportReportFields;
  report: RepairIntelligenceReport | null;
  analysis: AnalysisResult | null;
}): { low: number; high: number } | undefined {
  if (!hasDirectionalDvFallbackSupport(params)) {
    return undefined;
  }

  return { ...DV_FALLBACK_RANGE };
}

function hasDirectionalDvFallbackSupport(params: {
  panel: DecisionPanel | null;
  reportFields: ExportReportFields;
  report: RepairIntelligenceReport | null;
  analysis: AnalysisResult | null;
}): boolean {
  const vehicleYear =
    params.reportFields.vehicle?.year ?? params.reportFields.estimateFacts.vehicle?.year;
  const lateModelVehicle =
    typeof vehicleYear === "number" && vehicleYear >= new Date().getFullYear() - 10;
  const sourceText = collectVehicleDocumentText(params.report, params.analysis);
  const repairStory = sourceText ? buildRepairStory(sourceText) : null;
  const multiPanelRepair = Boolean(repairStory && repairStory.panels.length >= 2);
  const structuredImpact =
    Boolean(repairStory && (repairStory.structural || repairStory.impact !== "general")) ||
    (params.report?.issues.length ?? 0) > 0 ||
    (params.report?.missingProcedures.length ?? 0) > 0 ||
    (params.report?.supplementOpportunities.length ?? 0) > 0 ||
    (params.analysis?.findings.length ?? 0) > 0;
  const comparisonDispute =
    (params.analysis?.mode ?? params.report?.analysis?.mode) === "comparison";
  const calibrationOrStructuralSignals = /calibration|scan|adas|sensor|camera|radar|structural|measure|rail|support|pillar|apron/i.test(
    [
      params.panel?.narrative,
      params.panel?.supplements.map((item) => `${item.title} ${item.rationale}`).join(" "),
      params.report?.recommendedActions.join(" "),
      params.report?.missingProcedures.join(" "),
      params.report?.supplementOpportunities.join(" "),
      sourceText,
    ]
      .filter(Boolean)
      .join(" ")
  );

  const strongSignals = [multiPanelRepair, structuredImpact, comparisonDispute].filter(Boolean).length;
  const supportingSignals = [lateModelVehicle, calibrationOrStructuralSignals].filter(Boolean).length;

  return strongSignals >= 1 || strongSignals + supportingSignals >= 2;
}

function resolveValuationPreviewRange(params: {
  status: "provided" | "estimated_range" | "not_determinable";
  value?: number;
  range?: { low: number; high: number };
  maxRange: number;
  minSpread: number;
  spreadRatio: number;
}): { low: number; high: number } | undefined {
  if (params.status === "estimated_range" && isSaneRange(params.range, params.maxRange)) {
    return params.range;
  }

  if (params.status === "provided" && typeof params.value === "number") {
    return buildPreviewBandFromValue(params.value, params.minSpread, params.spreadRatio, params.maxRange);
  }

  return undefined;
}

function buildPreviewBandFromValue(
  value: number,
  minSpread: number,
  spreadRatio: number,
  maxRange: number
): { low: number; high: number } | undefined {
  if (!Number.isFinite(value) || value <= 0 || value > maxRange) {
    return undefined;
  }

  const spread = Math.max(minSpread, Math.round(value * spreadRatio));
  const range = {
    low: Math.max(1, value - spread),
    high: Math.min(maxRange, value + spread),
  };

  return isSaneRange(range, maxRange) ? range : undefined;
}

function resolveComputedAcv(params: {
  report: RepairIntelligenceReport | null;
  analysis: AnalysisResult | null;
  vehicle?: VehicleIdentity;
  mileage?: number;
}): ComputedAcvResult | null {
  const valuationData = extractStructuredValuationData(params.report, params.analysis);
  const fromComps = computeACVFromComps({
    vehicle: params.vehicle,
    mileage: params.mileage,
    comparableListings: valuationData.comparableListings,
  });
  if (fromComps) return fromComps;
  return computeACVFromJdPower(valuationData.jdPower);
}

export function computeACVFromComps(params: {
  vehicle?: VehicleIdentity;
  mileage?: number;
  comparableListings?: ComparableListing[];
}): ComputedAcvResult | null {
  const targetVehicle = params.vehicle;
  const normalizedTargetTrim = normalizeKey(targetVehicle?.trim ?? "");
  const adjusted = (params.comparableListings ?? [])
    .map((listing) => normalizeComparableListing(listing))
    .filter((listing): listing is NormalizedComparableListing => Boolean(listing))
    .filter((listing) => isComparableListingRelevant(listing, targetVehicle))
    .map((listing) => {
      const mileageAdjusted = applyMileageAdjustment(listing.price, params.mileage, listing.mileage);
      const yearAdjusted = applyYearAdjustment(mileageAdjusted, targetVehicle?.year, listing.year);
      const trimAdjusted = applyTrimAdjustment(yearAdjusted, normalizedTargetTrim, normalizeKey(listing.trim ?? ""));
      return {
        ...listing,
        adjustedPrice: Math.round(trimAdjusted),
        exactTrimMatch:
          Boolean(normalizedTargetTrim) &&
          Boolean(normalizeKey(listing.trim ?? "")) &&
          trimsLookEquivalent(normalizedTargetTrim, normalizeKey(listing.trim ?? "")),
      };
    })
    .filter((listing) => Number.isFinite(listing.adjustedPrice) && listing.adjustedPrice > 500);

  if (adjusted.length < 3) {
    return null;
  }

  const sorted = adjusted
    .map((listing) => listing.adjustedPrice)
    .sort((left, right) => left - right);
  const median = computeMedian(sorted);
  const low = computePercentile(sorted, 0.25);
  const high = computePercentile(sorted, 0.75);
  const range = {
    low: Math.min(low, median),
    high: Math.max(high, median),
  };

  if (!isSaneRange(range, 250000)) {
    return null;
  }

  const mileageKnownCount = adjusted.filter((listing) => typeof listing.mileage === "number").length;
  const exactTrimMatchCount = adjusted.filter((listing) => listing.exactTrimMatch).length;
  const confidence = deriveComparableConfidence({
    compCount: adjusted.length,
    mileageKnownCount,
    exactTrimMatchCount,
  });
  const notes = [
    `${adjusted.length} comparable listing${adjusted.length === 1 ? "" : "s"} used`,
    mileageKnownCount > 0 ? "mileage-normalized" : "limited mileage detail",
    normalizedTargetTrim
      ? exactTrimMatchCount > 0
        ? `${exactTrimMatchCount} trim-aligned`
        : "trim normalized conservatively"
      : "target trim not confirmed",
  ];

  return {
    acvRange: range,
    acvValue: median,
    confidence,
    compCount: adjusted.length,
    sourceType: "comps",
    reasoning: `ACV derived from ${notes.join(", ")} with median comparable pricing used as the working value.`,
  };
}

function computeACVFromJdPower(jdPower?: JDPowerValuation): ComputedAcvResult | null {
  if (!jdPower) return null;

  const low = coerceCurrencyValue(jdPower.low ?? jdPower.cleanTradeIn);
  const high = coerceCurrencyValue(jdPower.high ?? jdPower.cleanRetail);
  const average = coerceCurrencyValue(
    jdPower.average ??
      (typeof low === "number" && typeof high === "number" ? Math.round((low + high) / 2) : undefined)
  );

  if (typeof low !== "number" || typeof high !== "number" || typeof average !== "number") {
    return null;
  }

  const range = {
    low: Math.min(low, high),
    high: Math.max(low, high),
  };

  if (!isSaneRange(range, 250000)) {
    return null;
  }

  return {
    acvRange: range,
    acvValue: average,
    confidence: "medium",
    compCount: 0,
    sourceType: "jd_power",
    reasoning: "ACV derived from structured JD Power-style valuation data using the provided average and range.",
  };
}

type NormalizedComparableListing = {
  price: number;
  mileage?: number;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  source?: string;
  title?: string;
};

function extractStructuredValuationData(
  report: RepairIntelligenceReport | null,
  analysis: AnalysisResult | null
): StructuredValuationData {
  const candidates = [
    analysis,
    report?.analysis ?? null,
    report,
  ].filter(Boolean) as Array<Record<string, unknown>>;

  const valuationData: StructuredValuationData = {};

  for (const candidate of candidates) {
    const containers = [
      candidate,
      asRecord(candidate.valuationData),
      asRecord(candidate.marketValuation),
      asRecord(candidate.valuation),
      asRecord(candidate.acv),
      asRecord(candidate.marketData),
    ].filter(Boolean) as Array<Record<string, unknown>>;

    for (const container of containers) {
      if (!valuationData.comparableListings) {
        const listings = coerceComparableListings(
          container.comparableListings ??
            container.comps ??
            container.comparables ??
            container.listings
        );
        if (listings.length > 0) {
          valuationData.comparableListings = listings;
        }
      }

      if (!valuationData.jdPower) {
        const jdPower = coerceJdPowerValuation(
          container.jdPower ?? container.jd_power ?? container.jdpower
        );
        if (jdPower) {
          valuationData.jdPower = jdPower;
        }
      }
    }
  }

  return valuationData;
}

function coerceComparableListings(value: unknown): ComparableListing[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => ({
      price: coerceCurrencyValue(
        entry.price ??
          entry.askingPrice ??
          entry.listPrice ??
          asRecord(entry.price)?.amount
      ),
      askingPrice: coerceCurrencyValue(entry.askingPrice ?? entry.listPrice),
      mileage: coerceIntegerValue(entry.mileage ?? entry.odometer),
      year: coerceIntegerValue(entry.year),
      make: coerceStringValue(entry.make),
      model: coerceStringValue(entry.model),
      trim: coerceStringValue(entry.trim),
      source: coerceStringValue(entry.source ?? entry.sourceType ?? entry.provider),
      title: coerceStringValue(entry.title ?? entry.label ?? entry.name),
    }))
    .filter((entry) => typeof (entry.price ?? entry.askingPrice) === "number");
}

function coerceJdPowerValuation(value: unknown): JDPowerValuation | null {
  const record = asRecord(value);
  if (!record) return null;
  return {
    average: coerceCurrencyValue(record.average ?? record.mid ?? record.marketValue),
    low: coerceCurrencyValue(record.low ?? record.tradeIn ?? record.lowRetail),
    high: coerceCurrencyValue(record.high ?? record.cleanRetail ?? record.highRetail),
    cleanTradeIn: coerceCurrencyValue(record.cleanTradeIn),
    cleanRetail: coerceCurrencyValue(record.cleanRetail),
    source: coerceStringValue(record.source ?? record.provider),
  };
}

function normalizeComparableListing(
  listing: ComparableListing
): NormalizedComparableListing | null {
  const price = coerceCurrencyValue(listing.price ?? listing.askingPrice);
  if (typeof price !== "number" || price <= 500 || price > 250000) {
    return null;
  }

  return {
    price,
    mileage: coerceIntegerValue(listing.mileage),
    year: coerceIntegerValue(listing.year),
    make: cleanDisplayLabel(listing.make),
    model: cleanDisplayLabel(listing.model),
    trim: cleanVehicleDescriptor(listing.trim),
    source: cleanDisplayLabel(listing.source),
    title: cleanDisplayLabel(listing.title),
  };
}

function isComparableListingRelevant(
  listing: NormalizedComparableListing,
  targetVehicle?: VehicleIdentity
): boolean {
  const targetMake = normalizeKey(targetVehicle?.make ?? "");
  const targetModel = normalizeKey(targetVehicle?.model ?? "");
  const listingMake = normalizeKey(listing.make ?? "");
  const listingModel = normalizeKey(listing.model ?? "");

  if (targetMake && listingMake && targetMake !== listingMake) {
    return false;
  }
  if (targetModel && listingModel && targetModel !== listingModel) {
    return false;
  }
  if (
    typeof targetVehicle?.year === "number" &&
    typeof listing.year === "number" &&
    Math.abs(targetVehicle.year - listing.year) > 1
  ) {
    return false;
  }

  return true;
}

function applyMileageAdjustment(
  price: number,
  targetMileage?: number,
  compMileage?: number
): number {
  if (typeof targetMileage !== "number" || typeof compMileage !== "number") {
    return price;
  }

  const mileageDelta = compMileage - targetMileage;
  const adjustment = Math.max(-4000, Math.min(4000, Math.round(mileageDelta * 0.08)));
  return price - adjustment;
}

function applyYearAdjustment(
  price: number,
  targetYear?: number,
  compYear?: number
): number {
  if (typeof targetYear !== "number" || typeof compYear !== "number" || targetYear === compYear) {
    return price;
  }

  const yearDelta = compYear - targetYear;
  const rate = Math.min(Math.abs(yearDelta) * 0.04, 0.12);
  return Math.round(yearDelta > 0 ? price * (1 - rate) : price * (1 + rate));
}

function applyTrimAdjustment(
  price: number,
  targetTrim: string,
  compTrim: string
): number {
  if (!targetTrim || !compTrim || trimsLookEquivalent(targetTrim, compTrim)) {
    return price;
  }
  return Math.round(price * 0.975);
}

function trimsLookEquivalent(left: string, right: string): boolean {
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function deriveComparableConfidence(params: {
  compCount: number;
  mileageKnownCount: number;
  exactTrimMatchCount: number;
}): "low" | "medium" | "high" {
  if (
    params.compCount >= 5 &&
    params.mileageKnownCount >= Math.ceil(params.compCount / 2) &&
    params.exactTrimMatchCount >= Math.max(1, Math.floor(params.compCount / 2))
  ) {
    return "high";
  }

  if (
    params.compCount >= 3 &&
    (params.mileageKnownCount >= 2 || params.exactTrimMatchCount >= 1)
  ) {
    return "medium";
  }

  return "low";
}

function computeMedian(values: number[]): number {
  return computePercentile(values, 0.5);
}

function computePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const index = Math.max(0, Math.min(values.length - 1, Math.round((values.length - 1) * percentile)));
  return values[index];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function coerceCurrencyValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/[^0-9.-]/g, "");
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed) : undefined;
}

function coerceIntegerValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/[^0-9-]/g, "");
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed) : undefined;
}

function coerceStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function estimateFactsToVehicle(facts?: EstimateFacts): VehicleIdentity | undefined {
  return facts?.vehicle;
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
  if (
    lower.includes("calibration") ||
    lower.includes("radar") ||
    lower.includes("camera") ||
    lower.includes("sensor") ||
    lower.includes("adas") ||
    lower.includes("alignment")
  ) {
    return "calibration";
  }
  if (
    lower.includes("seam") ||
    lower.includes("corrosion") ||
    lower.includes("hardware") ||
    lower.includes("clip") ||
    lower.includes("seal") ||
    lower.includes("material") ||
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
  if (
    (looksLikeFrontEndOrFitSensitiveScope(lower) || lower.includes("fit-sensitive") || lower.includes("fit sensitive")) &&
    hasExplicitFitCheckLanguage(lower)
  ) {
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
  if (hasExplicitFitCheckLanguage(lower)) {
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
  if (hasTrueStructuralMeasurementSignals(lower)) {
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

  if (
    /^(?:missing procedures?|repair review|file review|estimate text|documentation|parts analysis|scan analysis|calibration analysis|oem procedure support|drive knowledge base)$/i.test(
      raw
    ) ||
    /^retrieved evidence\s*\d+$/i.test(raw)
  ) {
    return undefined;
  }

  if (/seam sealer/i.test(raw)) {
    return undefined;
  }

  if (
    /function not clearly represented in estimate|not clearly represented in estimate|not clearly documented in the current estimate|not clearly documented in the current material/i.test(
      raw
    )
  ) {
    return undefined;
  }

  const cleaned = raw
    .replace(/\bdecision panel\b/gi, "")
    .replace(/\bmissing procedure list\b/gi, "")
    .replace(/\bsupplement opportunity\b/gi, "")
    .replace(/\bstructured narrative\b/gi, "")
    .replace(/\bassistant reasoning\b/gi, "")
    .replace(/\bline mapping(?: engine)?\b/gi, "")
    .replace(/\bhybrid supplement(?: flow)?\b/gi, "")
    .replace(/\bdrive knowledge base\b/gi, "")
    .replace(/\bretrieved evidence\s*\d+\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[,;:\s-]+|[,;:\s-]+$/g, "")
    .trim();

  return cleaned || undefined;
}

function cleanFormalExportText(value?: string | null): string {
  const cleaned = cleanDisplayText(value);

  if (!cleaned) return "";

  return cleaned
    .replace(/\bPotential omissions \/ likely supplement areas\s*:\s*\.?/gi, "")
    .replace(/\bBottom line:\s*/gi, "")
    .replace(/\bStructured analysis\b/gi, "")
    .replace(/\bSupplement analysis\b/gi, "")
    .replace(/\bNarrative synthesis\b/gi, "")
    .replace(/\bStructured narrative\b/gi, "")
    .replace(/\bcurrent normalized repair analysis\b/gi, "current repair file")
    .replace(/\bexport model\b/gi, "supporting documentation")
    .replace(/\bfunction not clearly represented\b/gi, "not clearly documented")
    .replace(/\bthe current material does not clearly document\b/gi, "the file does not clearly support")
    .replace(/\bProc\s*-\s*Structural cues\b/gi, "")
    .replace(/\bMissing procedures?\b/gi, "")
    .replace(/\bRetrieved Evidence\s*\d+\b/gi, "")
    .replace(/\bDrive knowledge base\b/gi, "")
    .replace(/\bFile review\b/gi, "")
    .replace(/\bRepair review\b/gi, "")
    .replace(/\bOEM procedure support\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[,;:\s-]+|[,;:\s-]+$/g, "")
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
      "The file supports one-time-use hardware, seals, or clip replacement for the documented repair path, while the related parts, materials, or documentation remain open in the estimate."
    );
  }

  if (title === "ADAS / Calibration Procedure Support") {
    const normalized = normalizeSupplementText(cleaned);
    if (!normalized || looksLikeNoisySupplementText(normalized)) {
      return "The file supports scan, calibration, or related verification steps, but the estimate does not clearly document what was required or how it would be confirmed.";
    }

    return normalizeCalibrationReason(normalized);
  }

  if (title === "Headlamp aiming check") {
    const normalized = normalizeSupplementText(cleaned);
    if (!normalized || looksLikeNoisySupplementText(normalized)) {
      return "The file supports a headlamp aiming check after lamp or related component service, but that verification step is not clearly documented in the estimate.";
    }

    return normalizeHeadlampAimReason(normalized);
  }

  if (title === "Seam Sealer Restoration") {
    const withoutRefinishGlossary = filterSeamSealerText(cleaned);

    return (
      (withoutRefinishGlossary && !looksLikeNoisySupplementText(withoutRefinishGlossary)
        ? withoutRefinishGlossary
        : "") ||
      "The file would benefit from clearer seam sealer restoration documentation for the affected area, with supporting process or OEM material as needed."
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

  return "The file supports scan, calibration, or related verification steps, but the estimate does not clearly document what was required or how it would be confirmed.";
}

function normalizeHeadlampAimReason(value: string): string {
  const normalized = normalizeSupplementText(value);
  if (looksHeadlampAimFocused(normalized) && !looksLikeNoisySupplementText(normalized)) {
    return normalized;
  }

  return "The file supports a headlamp aiming check after lamp or related component service, but that verification step is not clearly documented in the estimate.";
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
    lower.includes("core support") ||
    lower.includes("guide") ||
    lower.includes("bracket")
  ) score += 85;
  if (
    lower.includes("rear body") ||
    lower.includes("deck opening") ||
    lower.includes("bumper reinforcement") ||
    lower.includes("absorber") ||
    lower.includes("blind spot") ||
    lower.includes("rear sensor") ||
    lower.includes("striker") ||
    lower.includes("latch")
  ) score += 85;
  if (lower.includes("setup") || lower.includes("measure") || lower.includes("realignment")) score += 110;
  if (lower.includes("replace vs repair") || lower.includes("repair vs replace")) score += 105;
  if (lower.includes("fit-sensitive") || lower.includes("fit sensitive")) score += 70;
  if (lower.includes("adas") || lower.includes("calibration procedure support")) score += 95;
  if (lower.includes("test fit")) score += 35;
  if (lower.includes("coolant") || lower.includes("bleed") || lower.includes("refill")) score += 95;
  if (lower.includes("hardware") || lower.includes("seal") || lower.includes("clip") || lower.includes("fastener")) score += 28;
  if (lower.includes("mounting geometry") || lower.includes("teardown") || lower.includes("hidden")) score += 30;
  if (lower.includes("corrosion") || lower.includes("cavity wax") || lower.includes("seam sealer") || lower.includes("weld protection")) score += 90;
  if (lower.includes("alignment")) score += 20;
  if (lower.includes("scan") || lower.includes("calibration")) score += 50;
  if (looksLikeMetaCommentary(lower)) score -= 400;
  if (lower.includes("not documented") || lower.includes("not clearly") || lower.includes("underwritten")) score += 40;
  score += Math.min(item.rationale.length, 100);
  return score;
}

function curateExportSupplementItems(
  items: ExportSupplementItem[],
  sourceText: string
): ExportSupplementItem[] {
  if (items.length <= 1) return items;

  const lowerSource = sourceText.toLowerCase();
  const frontSpecificExists = items.some(
    (item) =>
      inferExportSupplementFamily(item.title) === "front_structure_scope" &&
      !isGenericExportFallback(item.title)
  );
  const rearSpecificExists = items.some(
    (item) =>
      inferExportSupplementFamily(item.title) === "rear_structure_scope" &&
      !isGenericExportFallback(item.title)
  );
  const filtered = items.filter((item) => {
    if (item.title === "Four-Wheel Alignment" && !hasExportAlignmentEvidence(lowerSource)) {
      return false;
    }
    if (item.title === "One-Time-Use Hardware / Seals / Clips" && !hasExportHardwareEvidence(lowerSource, item)) {
      return false;
    }
    if (
      item.title === "Pre-Paint Test Fit" &&
      (!hasExplicitFitCheckLanguage(`${lowerSource} ${item.rationale.toLowerCase()} ${item.evidence?.toLowerCase() ?? ""}`) ||
        !looksLikeFrontEndOrFitSensitiveScope(
          `${lowerSource} ${item.rationale.toLowerCase()} ${item.evidence?.toLowerCase() ?? ""}`
        ))
    ) {
      return false;
    }
    if (
      item.title === "ADAS / Calibration Procedure Support" &&
      !hasExportAdasProcedureEvidence(lowerSource, item)
    ) {
      return false;
    }
    if (
      item.title === "Structural Measurement Verification" &&
      !hasExportMeasurementEvidence(lowerSource) &&
      (frontSpecificExists || rearSpecificExists)
    ) {
      return false;
    }
    if (
      item.title === "Hidden Mounting Geometry / Teardown Growth" &&
      (!hasExportHiddenMountingEvidence(lowerSource, item) ||
        (isLightFrontBumperDrivenExportFile(lowerSource, item) &&
          !hasExportHiddenMountingEvidence(lowerSource, item)))
    ) {
      return false;
    }
    return true;
  });

  const kept: ExportSupplementItem[] = [];
  const seenFamilies = new Set<string>();
  let genericFallbacks = 0;

  for (const item of [...filtered].sort((left, right) =>
    scoreExportSupplementItemInContext(right, lowerSource) - scoreExportSupplementItemInContext(left, lowerSource)
  )) {
    const family = inferExportSupplementFamily(item.title);
    const generic = isGenericExportFallback(item.title);

    if (seenFamilies.has(family)) {
      continue;
    }
    if (generic && genericFallbacks >= 1) {
      continue;
    }

    kept.push(item);
    seenFamilies.add(family);
    if (generic) genericFallbacks += 1;
  }

  return kept;
}

function inferExportSupplementFamily(title: string): string {
  const lower = title.toLowerCase();

  if (
    lower.includes("front structure") ||
    lower.includes("tie bar") ||
    lower.includes("lock support") ||
    lower.includes("core support") ||
    lower.includes("upper rail") ||
    lower.includes("support area") ||
    lower.includes("hidden mounting")
  ) {
    return "front_structure_scope";
  }
  if (
    lower.includes("rear body") ||
    lower.includes("deck opening") ||
    lower.includes("bumper reinforcement") ||
    lower.includes("absorber") ||
    lower.includes("rear sensor") ||
    lower.includes("blind spot") ||
    lower.includes("deck lid") ||
    lower.includes("latch") ||
    lower.includes("striker")
  ) {
    return "rear_structure_scope";
  }
  if (lower.includes("test fit") || lower.includes("fit-sensitive")) return "fit_verification";
  if (lower.includes("alignment")) return "alignment";
  if (lower.includes("hardware") || lower.includes("clip") || lower.includes("fastener")) return "hardware";
  if (lower.includes("measure") || lower.includes("setup") || lower.includes("realignment")) {
    return "structural_measurement";
  }
  if (lower.includes("scan") || lower.includes("calibration") || lower.includes("sensor") || lower.includes("aim")) {
    return "verification";
  }
  if (lower.includes("corrosion") || lower.includes("seam") || lower.includes("weld")) {
    return "corrosion";
  }
  return title.toLowerCase();
}

function isGenericExportFallback(title: string): boolean {
  return [
    "Four-Wheel Alignment",
    "One-Time-Use Hardware / Seals / Clips",
    "Structural Measurement Verification",
    "Hidden Mounting Geometry / Teardown Growth",
  ].includes(title);
}

function hasExportAlignmentEvidence(value: string): boolean {
  return (
    value.includes("alignment") ||
    value.includes("toe") ||
    value.includes("camber") ||
    value.includes("caster") ||
    value.includes("suspension") ||
    value.includes("steering") ||
    value.includes("subframe")
  );
}

function hasExportHardwareEvidence(value: string, item: ExportSupplementItem): boolean {
  const combined = `${value} ${item.rationale} ${item.evidence ?? ""}`.toLowerCase();
  return (
    combined.includes("one-time-use") ||
    combined.includes("one time use") ||
    combined.includes("hardware") ||
    combined.includes("fastener") ||
    combined.includes("retainer") ||
    /\bclip(s)?\b/i.test(combined) ||
    /\bseal(s)?\b/i.test(combined)
  );
}

function hasExportMeasurementEvidence(value: string): boolean {
  return (
    /(measure|measurement|measuring)/.test(value) ||
    /\bframe\b/.test(value) ||
    /\bbench\b/.test(value) ||
    /\bsetup\b/.test(value) ||
    /\bpull\b/.test(value) ||
    /realign(?:ment)?/.test(value) ||
    /dimension(?:s|al)?/.test(value) ||
    /\bdatum\b/.test(value) ||
    /\bgeometry\b/.test(value) ||
    hasVerifiedStructuralZoneEvidence(value)
  );
}

function hasExportAdasProcedureEvidence(value: string, item?: ExportSupplementItem): boolean {
  const combined = `${value} ${item?.rationale ?? ""} ${item?.evidence ?? ""}`.toLowerCase();
  const hasAdasSubject =
    combined.includes("adas") ||
    combined.includes("calibration") ||
    combined.includes("camera") ||
    combined.includes("radar") ||
    combined.includes("sensor") ||
    combined.includes("scan");
  const hasProcedureContext =
    combined.includes("procedure") ||
    combined.includes("calibrate") ||
    combined.includes("calibration") ||
    combined.includes("scan") ||
    combined.includes("verification") ||
    combined.includes("aim");

  return hasAdasSubject && hasProcedureContext;
}

function hasExportSupportScopeEvidence(value: string): boolean {
  return (
    value.includes("tie bar") ||
    value.includes("lock support") ||
    value.includes("core support") ||
    value.includes("radiator support") ||
    value.includes("support area") ||
    value.includes("upper rail") ||
    value.includes("guide") ||
    value.includes("bracket") ||
    value.includes("mount")
  );
}

function hasExportHiddenMountingEvidence(value: string, item?: ExportSupplementItem): boolean {
  const combined = `${value} ${item?.rationale ?? ""} ${item?.evidence ?? ""}`.toLowerCase();
  return (
    hasExportSupportScopeEvidence(combined) ||
    combined.includes("reinforcement") ||
    combined.includes("absorber") ||
    combined.includes("shutter") ||
    combined.includes("duct") ||
    combined.includes("ducting") ||
    combined.includes("hidden bracket") ||
    combined.includes("mounting disturbance") ||
    combined.includes("mounting geometry") ||
    combined.includes("teardown")
  );
}

function isLightFrontBumperDrivenExportFile(value: string, item?: ExportSupplementItem): boolean {
  const combined = `${value} ${item?.rationale ?? ""} ${item?.evidence ?? ""}`.toLowerCase();
  const hasLightSignals =
    combined.includes("bumper") ||
    combined.includes("fascia") ||
    combined.includes("trim") ||
    combined.includes("sensor") ||
    combined.includes("scan");
  const lacksHeavySignals =
    !hasExportHiddenMountingEvidence(combined, item) &&
    !hasExportMeasurementEvidence(combined) &&
    !combined.includes("structure") &&
    !combined.includes("rail") &&
    !combined.includes("apron");

  return hasLightSignals && lacksHeavySignals;
}

function hasVerifiedStructuralZoneEvidence(value: string): boolean {
  return (
    /\b(?:rail|apron)\b.{0,40}\b(?:measure|measurement|measuring|setup|pull|realign|datum|geometry|dimension)\b/.test(
      value
    ) ||
    /\b(?:measure|measurement|measuring|setup|pull|realign|datum|geometry|dimension)\b.{0,40}\b(?:rail|apron)\b/.test(
      value
    )
  );
}

function hasExplicitFitCheckLanguage(value: string): boolean {
  return (
    /test fit/.test(value) ||
    /test-fit/.test(value) ||
    /fit check/.test(value) ||
    /fit-check/.test(value) ||
    /mock up/.test(value) ||
    /mock-up/.test(value) ||
    /fit verification/.test(value) ||
    /gap confirmation/.test(value) ||
    /aim confirmation/.test(value)
  );
}

function looksLikeFrontEndOrFitSensitiveScope(value: string): boolean {
  return (
    /\bfront(?:-|\s)?end\b/.test(value) ||
    /\bbumper\b/.test(value) ||
    /\bfascia\b/.test(value) ||
    /\bfender\b/.test(value) ||
    /\blamp\b/.test(value) ||
    /\bheadlamp\b/.test(value) ||
    /\bgrille\b/.test(value) ||
    /\bhood\b/.test(value) ||
    /\bfit-sensitive\b/.test(value) ||
    /\bgap\b/.test(value) ||
    /\baim\b/.test(value)
  );
}

function hasTrueStructuralMeasurementSignals(value: string): boolean {
  return (
    /(measure|measurement|measuring)/.test(value) ||
    /\bframe\b/.test(value) ||
    /\bbench\b/.test(value) ||
    /\bsetup\b/.test(value) ||
    /\bpull\b/.test(value) ||
    /realign(?:ment)?/.test(value) ||
    /dimension(?:s|al)?/.test(value) ||
    /\bdatum\b/.test(value) ||
    /\bgeometry\b/.test(value) ||
    hasVerifiedStructuralZoneEvidence(value)
  );
}

function hasMajorFitStackUpEvidence(value: string): boolean {
  const lower = value.toLowerCase();
  const fitSignals = [
    "hood",
    "fender",
    "lamp",
    "headlamp",
    "grille",
    "gap",
    "aim",
    "fit-sensitive",
    "fit sensitive",
    "camera",
  ].filter((signal) => lower.includes(signal)).length;

  return fitSignals >= 2;
}

function scoreExportSupplementItemInContext(item: ExportSupplementItem, sourceText: string): number {
  const combined = `${sourceText} ${item.title} ${item.rationale} ${item.evidence ?? ""}`.toLowerCase();
  let score = scoreSupplementItem(item);

  if (item.title === "Pre-Paint Test Fit") {
    if (!hasMajorFitStackUpEvidence(combined)) score -= 120;
    if (isLightFrontBumperDrivenExportFile(sourceText, item)) score -= 140;
  }

  if (item.title === "Hidden Mounting Geometry / Teardown Growth") {
    if (isLightFrontBumperDrivenExportFile(sourceText, item)) score -= 180;
    if (hasExportHiddenMountingEvidence(sourceText, item)) score += 30;
  }

  if (item.title === "ADAS / Calibration Procedure Support") {
    if (!hasExportAdasProcedureEvidence(sourceText, item)) score -= 180;
    if (/\b(?:camera|sensor|scan|calibration|park sensor|front camera)\b/.test(combined)) score += 45;
  }

  if (/\b(?:bumper|grille|trim|park sensor|front camera|absorber|reinforcement|guide|bracket|shutter|duct)\b/.test(combined)) {
    score += 35;
  }

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

  if (hasExplicitFitCheckLanguage(text) && looksLikeFrontEndOrFitSensitiveScope(text)) {
    add(
      "Pre-Paint Test Fit",
      "Test-fit or fit-check work appears supportable for adjacent panels before final finish work.",
      "high",
      "underwritten_operation"
    );
  }

  if (hasTrueStructuralMeasurementSignals(text)) {
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
    if (hasNarrativeSupportScopeEvidence(text)) {
      add(
        "Hidden Mounting Geometry / Teardown Growth",
        "Teardown growth or hidden mounting-geometry burden appears supportable here, but that broader scope is not fully reflected in the current estimate.",
        "high",
        "disputed_repair_path"
      );
    }
  }

  if (hasNarrativeHardwareEvidence(text)) {
    add(
      "One-Time-Use Hardware / Seals / Clips",
      "The file supports one-time-use hardware, seals, clips, or related replacement burden, but the estimate does not yet clearly show what should be added or documented.",
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

  if (hasNarrativeAlignmentEvidence(text)) {
    add(
      "Four-Wheel Alignment",
      "Alignment appears relevant to the documented repair scope, but that operation is not clearly documented in the current estimate.",
      "medium",
      "missing_verification"
    );
  }

  return candidates
    .filter((item, index, all) => all.findIndex((entry) => normalizeKey(entry.title) === normalizeKey(item.title)) === index)
    .sort(sortSupplementItems);
}

function hasNarrativeAlignmentEvidence(text: string): boolean {
  return (
    text.includes("alignment") ||
    text.includes("toe") ||
    text.includes("camber") ||
    text.includes("caster") ||
    text.includes("suspension") ||
    text.includes("steering") ||
    text.includes("subframe")
  );
}

function hasNarrativeHardwareEvidence(text: string): boolean {
  return (
    text.includes("one-time-use") ||
    text.includes("one time use") ||
    text.includes("hardware") ||
    text.includes("fastener") ||
    text.includes("retainer") ||
    /\bclip(s)?\b/i.test(text) ||
    /\bseal(s)?\b/i.test(text) ||
    text.includes("non-reusable") ||
    text.includes("replace hardware")
  );
}

function hasNarrativeSupportScopeEvidence(text: string): boolean {
  return (
    text.includes("tie bar") ||
    text.includes("lock support") ||
    text.includes("core support") ||
    text.includes("radiator support") ||
    text.includes("support area") ||
    text.includes("upper rail") ||
    text.includes("guide") ||
    text.includes("bracket") ||
    text.includes("mount")
  );
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

function summarizeExportValuationBand(params: {
  label: string;
  status: "provided" | "estimated_range" | "not_determinable";
  value?: number;
  range?: { low: number; high: number };
  maxRange: number;
}): string {
  if (params.status === "estimated_range" && isSaneRange(params.range, params.maxRange)) {
    return `${params.label}: ${formatCompactCurrency(params.range.low)}-${formatCompactCurrency(params.range.high)} (directional only)`;
  }

  if (params.status === "provided" && typeof params.value === "number") {
    return `${params.label}: around ${formatCompactCurrency(params.value)} (directional only)`;
  }

  return `${params.label}: directional range not strongly supported from the current file set`;
}

function formatCompactCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
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
    .replace(/\bNo clear structural measuring listed\.?\b/gi, "")
    .replace(/\bWhere it looks incomplete or likely to supplement:\.?/gi, "")
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

function stripUnsupportedSeamSealerLanguage(
  value?: string | null,
  sourceText = "",
  preserveWhenCurated = false
): string {
  const cleaned = value ?? "";
  if (!cleaned) return "";

  if (preserveWhenCurated || hasExplicitSeamSealerSupport(sourceText)) {
    return cleaned;
  }

  return cleaned
    .replace(/\bAdd and document Seam sealer application before final repair delivery\.?/gi, "")
    .replace(
      /\bPlease review whether Seam sealer application not clearly documented in estimate is already represented in the estimate and what should be added or documented more clearly if it remains part of the repair path\.?/gi,
      ""
    )
    .replace(/\bseam sealer restore\/apply operation\b/gi, "matching repair-process support")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function hasExplicitSeamSealerSupport(sourceText: string): boolean {
  const lower = sourceText.toLowerCase();
  return /(seam sealer|joint sealing|sealer application|weld protection|weld prep|weld-through primer|weld thru primer)/.test(
    lower
  );
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
