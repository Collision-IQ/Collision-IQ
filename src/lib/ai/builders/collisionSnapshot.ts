import type { ExportModel } from "./buildExportModel";
import { isCarrierSelectedPosture } from "@/lib/ai/estimatePosture";
import { type PressureMode, computeItemPressureMode } from "./pressureMode";
import { cleanOperationDisplayText } from "@/lib/ui/presentationText";
import type { EstimateComparisonRow, WorkspaceEstimateComparisons } from "@/types/workspaceTypes";
import { toCustomerFacingText } from "@/lib/ai/customerFacingText";

export type SnapshotRedactionOptions = {
  showInsurerName?: boolean;
  showShopName?: boolean;
};

export type CollisionSnapshot = {
  title: string;
  vehicleLabel: string;
  damageSummary: string[];
  repairPlanVerdict: {
    moreCompletePlan: "SHOP" | "CARRIER" | "INCONCLUSIVE";
    carrierPlanStatus: "COMPLETE" | "PARTIAL" | "LIGHT" | "INCONCLUSIVE";
    reason: string;
  };
  estimateComparison: {
    available: boolean;
    shopEstimateTotal?: string;
    carrierEstimateTotal?: string;
    difference?: string;
    keyDeltas: string[];
    unavailableReason?: string;
  };
  topDisputeItems: Array<{
    issue: string;
    whyItMatters: string;
    evidenceState: string;
    nextAction: string;
    pressureMode: PressureMode;
  }>;
  pressureMode: PressureMode;
  pressureModeRationale: string;
  evidenceCompleteness: {
    adjustedConfidence: ExportModel["confidenceIntegrity"]["adjustedConfidence"];
    completenessStatus: ExportModel["confidenceIntegrity"]["completenessStatus"];
    uploadedFileCount: number;
    indexedFileCount: number;
    reviewedFileCount: number;
    reviewableFileCount: number;
    excludedFromReviewCount: number;
    excludedFromReviewReasons: ExportModel["confidenceIntegrity"]["excludedFromReviewReasons"];
    excludedFromReviewFiles: ExportModel["confidenceIntegrity"]["excludedFromReviewFiles"];
    totalKnownFileCount: number;
    uploadLimitReached: boolean;
    userIndicatedMoreFiles: boolean;
    missingCriticalEvidence: string[];
    userFacingDisclosure: string;
  };
  nextActions: string[];
  verdictLine?: string;
  valuationSnapshot: {
    available: boolean;
    acvPreviewRange?: string;
    dvPreviewRange?: string;
    confidence?: string;
    disclosure: string;
  };
  disclosure: string;
  redactionNotice: string;
};

type SnapshotRenderModel = Omit<ExportModel, "collisionSnapshot"> & Partial<Pick<ExportModel, "collisionSnapshot">>;
type SnapshotSource =
  | SnapshotRenderModel
  | { renderModel: SnapshotRenderModel; estimateComparisons?: WorkspaceEstimateComparisons | null };

const BANNED_GENERIC_PHRASES = [
  "credible preliminary repair plan",
  "support remains open",
  "repair path appears supportable",
  "procedure support should not be treated as no support",
  "file documents several parts",
  "current file set supports",
  "the narrative supports",
] as const;

export function buildCollisionSnapshot(input: SnapshotSource): CollisionSnapshot {
  const renderModel = "renderModel" in input ? input.renderModel : input;
  const snapshotSafeReport = buildSnapshotSafeReport(renderModel);
  const estimateComparisons = "renderModel" in input ? input.estimateComparisons : undefined;

  const snapshot: CollisionSnapshot = {
    title: "Collision Snapshot",
    vehicleLabel: buildSnapshotVehicleLabel(snapshotSafeReport),
    damageSummary: buildDamageSummary(snapshotSafeReport),
    repairPlanVerdict: buildRepairPlanVerdict(snapshotSafeReport),
    estimateComparison: buildEstimateComparison(snapshotSafeReport, estimateComparisons),
    topDisputeItems: buildTopDisputeItems(snapshotSafeReport),
    evidenceCompleteness: {
      adjustedConfidence: snapshotSafeReport.confidenceIntegrity.adjustedConfidence,
      completenessStatus: snapshotSafeReport.confidenceIntegrity.completenessStatus,
      uploadedFileCount: snapshotSafeReport.confidenceIntegrity.uploadedFileCount,
      indexedFileCount:
        snapshotSafeReport.confidenceIntegrity.indexedFileCount ??
        snapshotSafeReport.confidenceIntegrity.uploadedFileCount,
      reviewedFileCount: snapshotSafeReport.confidenceIntegrity.reviewedFileCount ?? 0,
      reviewableFileCount:
        snapshotSafeReport.confidenceIntegrity.reviewableFileCount ??
        snapshotSafeReport.confidenceIntegrity.reviewedFileCount ??
        snapshotSafeReport.confidenceIntegrity.uploadedFileCount,
      excludedFromReviewCount: snapshotSafeReport.confidenceIntegrity.excludedFromReviewCount ?? 0,
      excludedFromReviewReasons: snapshotSafeReport.confidenceIntegrity.excludedFromReviewReasons ?? [],
      excludedFromReviewFiles: snapshotSafeReport.confidenceIntegrity.excludedFromReviewFiles ?? [],
      totalKnownFileCount:
        snapshotSafeReport.confidenceIntegrity.totalKnownFileCount ??
        snapshotSafeReport.confidenceIntegrity.uploadedFileCount,
      uploadLimitReached: snapshotSafeReport.confidenceIntegrity.uploadLimitReached,
      userIndicatedMoreFiles: snapshotSafeReport.confidenceIntegrity.userIndicatedMoreFiles,
      missingCriticalEvidence: snapshotSafeReport.confidenceIntegrity.missingCriticalEvidence.slice(0, 5),
      userFacingDisclosure: snapshotSafeReport.confidenceIntegrity.userFacingDisclosure,
    },
    nextActions: buildNextActions(snapshotSafeReport),
    verdictLine: buildVerdictLine(snapshotSafeReport, estimateComparisons),
    valuationSnapshot: buildValuationSnapshot(snapshotSafeReport),
    disclosure: buildSnapshotDisclosure(snapshotSafeReport),
    redactionNotice: "Sensitive details removed for sharing.",
    pressureMode: snapshotSafeReport.pressureMode.mode,
    pressureModeRationale: snapshotSafeReport.pressureMode.rationale,
  };

  return sanitizeSnapshot(snapshot);
}

export function buildSnapshotSafeReport<T>(report: T, options: SnapshotRedactionOptions = {}): T {
  return redactSensitiveData(report, options);
}

export function redactSensitiveData<T>(report: T, options: SnapshotRedactionOptions = {}): T {
  const seen = new WeakMap<object, unknown>();

  function redactValue(value: unknown, key = ""): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === "string") return redactSnapshotText(value, key, options);
    if (typeof value !== "object") return value;

    if (seen.has(value)) {
      return seen.get(value);
    }

    if (Array.isArray(value)) {
      const output: unknown[] = [];
      seen.set(value, output);
      value.forEach((item) => output.push(redactValue(item, key)));
      return output;
    }

    const output: Record<string, unknown> = {};
    seen.set(value, output);
    for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
      if (/^debug$/i.test(entryKey)) continue;
      if (/address|street|phone|email/i.test(entryKey)) continue;
      if (/customer|claimant|owner|insured|policyholder/i.test(entryKey)) {
        output[entryKey] = "Vehicle Owner";
        continue;
      }
      if (/claim(?:number|no|id)?$/i.test(entryKey) || /claimNumber|claimNo|claimId/i.test(entryKey)) {
        output[entryKey] =
          typeof entryValue === "string" || typeof entryValue === "number"
            ? maskIdentifierLast4(String(entryValue))
            : "[REDACTED_CLAIM]";
        continue;
      }
      if (/insurer|insurance/i.test(entryKey) && !options.showInsurerName) {
        output[entryKey] = "[INSURER HIDDEN]";
        continue;
      }
      if (/\bshop\b|repairFacility|bodyShop/i.test(entryKey) && !options.showShopName) {
        output[entryKey] = "[SHOP HIDDEN]";
        continue;
      }
      output[entryKey] = redactValue(entryValue, entryKey);
    }

    return output;
  }

  return redactValue(report) as T;
}

function buildSnapshotVehicleLabel(renderModel: SnapshotRenderModel): string {
  const parts = [renderModel.vehicle.year, renderModel.vehicle.make, renderModel.vehicle.model]
    .filter(Boolean)
    .map(String);

  return parts.join(" ").trim() || "Vehicle not specified";
}

function buildDamageSummary(renderModel: SnapshotRenderModel): string[] {
  const candidates = [
    ...renderModel.reportFields.documentedHighlights,
    ...renderModel.reportFields.documentedProcedures,
    ...renderModel.supplementItems.map((item) => item.evidence || item.rationale),
    ...renderModel.findingReasoning.map((finding) => finding.what_proves_it),
  ];
  const claimSpecific = candidates
    .map((item) => cleanSnapshotText(item))
    .filter((item): item is string => Boolean(item))
    .filter((item) => /impact|bumper|quarter|lamp|wheel|door|fender|hood|roof|rail|apron|pillar|structure|refinish|replace|repair|align|measure/i.test(item));

  return dedupe(claimSpecific).slice(0, 3).length
    ? dedupe(claimSpecific).slice(0, 3)
    : ["Damage summary is limited to the current uploaded and retrieved file set."];
}

function buildRepairPlanVerdict(renderModel: SnapshotRenderModel): CollisionSnapshot["repairPlanVerdict"] {
  const incomplete = renderModel.confidenceIntegrity.completenessStatus !== "COMPLETE";
  const posture = renderModel.selectedEstimatePosture ?? {
    selectedEstimateLabel: "undetermined",
    selectedEstimateReason: "The shared estimate posture is not available for this snapshot.",
    confidence: "low",
    limitations: [],
  };
  const moreCompletePlan =
    posture.selectedEstimateLabel === "shop"
      ? "SHOP"
      : isCarrierSelectedPosture(posture)
        ? "CARRIER"
        : "INCONCLUSIVE";
  const carrierPlanStatus =
    moreCompletePlan !== "CARRIER" && renderModel.confidenceIntegrity.adjustedConfidence === "High"
      ? "PARTIAL"
      : moreCompletePlan !== "CARRIER" && moreCompletePlan !== "INCONCLUSIVE"
        ? "LIGHT"
        : incomplete
          ? "INCONCLUSIVE"
          : "COMPLETE";
  const reasonBase = posture.selectedEstimateReason;
  const reason = incomplete
    ? `${reasonBase} Because the file set is not complete, this snapshot is not a final repair conclusion.`
    : reasonBase;

  return { moreCompletePlan, carrierPlanStatus, reason };
}

function buildEstimateComparison(
  renderModel: SnapshotRenderModel,
  estimateComparisons?: WorkspaceEstimateComparisons | null
): CollisionSnapshot["estimateComparison"] {
  const rows = estimateComparisons?.rows ?? [];
  const comparisonRows = rows.filter((row) => row.deltaType && row.deltaType !== "same");
  const totalRow = rows.find((row) => /total/i.test(`${row.category ?? ""} ${row.operation ?? ""} ${row.partName ?? ""}`));
  const shopTotal = numericValue(totalRow?.lhsValue);
  const carrierTotal = numericValue(totalRow?.rhsValue);
  const hasBothTotals = typeof shopTotal === "number" && typeof carrierTotal === "number";
  const keyDeltas = comparisonRows
    .map(formatComparisonDelta)
    .filter((item): item is string => Boolean(item))
    .slice(0, 5);

  if (!hasBothTotals && keyDeltas.length === 0) {
    return {
      available: false,
      keyDeltas: [],
      unavailableReason: "Estimate comparison is unavailable from the current file.",
    };
  }

  return {
    available: true,
    ...(hasBothTotals
      ? {
          shopEstimateTotal: formatMoney(shopTotal),
          carrierEstimateTotal: formatMoney(carrierTotal),
          difference: formatMoney(shopTotal - carrierTotal),
        }
      : {}),
    keyDeltas,
  };
}

function buildVerdictLine(
  renderModel: SnapshotRenderModel,
  estimateComparisons?: WorkspaceEstimateComparisons | null
): string | undefined {
  const hasLaborDelta =
    renderModel.supplementItems.some((item) => /labor/i.test(item.category)) ||
    (estimateComparisons?.rows ?? []).some(
      (row) =>
        /labor/i.test(`${row.category ?? ""} ${row.operation ?? ""}`) &&
        row.deltaType &&
        row.deltaType !== "same"
    );

  const hasMissingVerification =
    renderModel.supplementItems.some((item) => item.kind === "missing_verification") ||
    renderModel.confidenceIntegrity.missingCriticalEvidence.length > 0;

  if (hasLaborDelta && hasMissingVerification) {
    return "Carrier estimate likely incomplete based on current evidence.";
  }
  return undefined;
}

function buildTopDisputeItems(renderModel: SnapshotRenderModel): CollisionSnapshot["topDisputeItems"] {
  const rankedFindings = [...renderModel.findingReasoning].sort(
    (left, right) => (right.leverageScore ?? 0) - (left.leverageScore ?? 0)
  );
  const displayFindings = rankSnapshotFindingsForDisplay(renderModel, rankedFindings);

  return displayFindings.slice(0, 3).map((finding) => ({
    issue: cleanSnapshotText(finding.issue) || "Repair item to review",
    whyItMatters: cleanSnapshotText(finding.why_it_matters) || "This item may affect repair quality, safety, or final fit.",
    evidenceState: "The current file points to this concern and it should be confirmed during repair review.",
    nextAction:
      cleanSnapshotText(finding.next_action) ||
      "Ask the insurer or repair shop to explain whether this item is included, and if not, why.",
    pressureMode: computeItemPressureMode(finding.evidenceLevel, finding.leverageScore ?? 0),
  }));
}

function rankSnapshotFindingsForDisplay(
  renderModel: SnapshotRenderModel,
  rankedFindings: SnapshotRenderModel["findingReasoning"]
): SnapshotRenderModel["findingReasoning"] {
  if (!hasSideImpactRepairContext(renderModel)) return rankedFindings;

  const sideSpecific = rankedFindings
    .filter((finding) => !isGenericFrontEndFinding(finding))
    .sort((left, right) => snapshotDisplayScore(right) - snapshotDisplayScore(left));

  return sideSpecific.length ? sideSpecific : rankedFindings;
}

function hasSideImpactRepairContext(renderModel: SnapshotRenderModel): boolean {
  const context = [
    ...renderModel.reportFields.documentedHighlights,
    ...renderModel.reportFields.documentedProcedures,
    ...renderModel.supplementItems.map((item) => `${item.category} ${item.evidence} ${item.rationale}`),
    ...renderModel.findingReasoning.map(
      (finding) => `${finding.issue} ${finding.what_proves_it} ${finding.why_it_matters} ${finding.next_action}`
    ),
  ].join(" ");

  return /\b(?:left|lt|lh|side|door|quarter|rocker|pillar|aperture|wheel|blind spot|side radar)\b/i.test(context);
}

function isGenericFrontEndFinding(finding: SnapshotRenderModel["findingReasoning"][number]): boolean {
  const text = `${finding.issue} ${finding.what_proves_it} ${finding.why_it_matters} ${finding.next_action}`;
  return (
    /\b(?:front[-\s]?end|front structure|front support|tie bar|upper rail|front bumper|grille|hood|headlamp|front camera|front radar|radiator support|core support)\b/i.test(text) &&
    !/\b(?:side|left|lt|lh|door|quarter|rocker|pillar|aperture|wheel|alignment|blind spot|side radar)\b/i.test(text)
  );
}

function snapshotDisplayScore(finding: SnapshotRenderModel["findingReasoning"][number]): number {
  const text = `${finding.issue} ${finding.what_proves_it} ${finding.why_it_matters} ${finding.next_action}`;
  const base = finding.leverageScore ?? 0;
  const sideDriverBoost =
    /\b(?:side structure|left|door|quarter|rocker|pillar|aperture|wheel|adas|calibration|scan|repair completeness|complete repairs|fit)\b/i.test(text)
      ? 50
      : 0;
  return base + sideDriverBoost;
}

function buildNextActions(renderModel: SnapshotRenderModel): string[] {
  const missingProof = renderModel.confidenceIntegrity.missingCriticalEvidence.slice(0, 3);
  return [
    "Ask the repair shop which items still need teardown, scan, calibration, fit, or alignment confirmation.",
    "Ask the insurer or repair shop to explain whether this item is included, and if not, why.",
    missingProof.length
      ? `Ask what is still needed for ${joinHumanList(missingProof.map((item) => cleanSnapshotText(item) ?? item))}.`
      : "Ask what will be checked before the estimate is considered complete.",
  ];
}

function buildValuationSnapshot(renderModel: SnapshotRenderModel): CollisionSnapshot["valuationSnapshot"] {
  const acvPreviewRange = formatValuationRange(renderModel.valuation.acvRange);
  const dvPreviewRange = formatValuationRange(renderModel.valuation.dvRange);

  if (!acvPreviewRange && !dvPreviewRange) {
    return {
      available: false,
      disclosure: renderModel.valuation.acvReasoning || "Market Preview unavailable: no completed comparable listings or supported valuation data were preserved for this generation.",
    };
  }

  return {
    available: true,
    acvPreviewRange,
    dvPreviewRange,
    confidence: [
      renderModel.valuation.acvConfidence ? `Market preview ${renderModel.valuation.acvConfidence}` : null,
      renderModel.valuation.dvConfidence ? `DV ${renderModel.valuation.dvConfidence}` : null,
    ].filter(Boolean).join(" / ") || "Directional",
    disclosure: "Market preview only; not a formal valuation or appraisal.",
  };
}

function buildSnapshotDisclosure(renderModel: SnapshotRenderModel): string {
  if (renderModel.confidenceIntegrity.completenessStatus === "COMPLETE") {
    return "Snapshot is based on the included claim-specific findings and retrieved support available now.";
  }

  return `Snapshot is based on an incomplete file set. ${renderModel.confidenceIntegrity.userFacingDisclosure}`;
}

function sanitizeSnapshot(snapshot: CollisionSnapshot): CollisionSnapshot {
  const sanitized = redactSensitiveData(mapSnapshotStrings(snapshot, (value) => cleanSnapshotText(value) || ""));
  if (
    sanitized.valuationSnapshot.available &&
    !sanitized.valuationSnapshot.acvPreviewRange &&
    !sanitized.valuationSnapshot.dvPreviewRange
  ) {
    const disclosure =
      sanitized.valuationSnapshot.disclosure &&
      !/^Market preview only\b/i.test(sanitized.valuationSnapshot.disclosure)
        ? sanitized.valuationSnapshot.disclosure
        : "Market Preview unavailable: no completed live local comparable listings or supported valuation data were preserved for this generation.";

    return {
      ...sanitized,
      valuationSnapshot: {
        available: false,
        disclosure,
      },
    };
  }
  return sanitized;
}

function mapSnapshotStrings<T>(value: T, transform: (value: string) => string): T {
  if (typeof value === "string") return transform(value) as T;
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => mapSnapshotStrings(item, transform)) as T;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      mapSnapshotStrings(entry, transform),
    ])
  ) as T;
}

function redactSnapshotText(value: string, key: string, options: SnapshotRedactionOptions): string {
  let output = value;
  output = output.replace(/\b[A-HJ-NPR-Z0-9]{17}\b/g, (vin) => maskIdentifierLast4(vin));
  output = output.replace(
    /\bclaim\s*(?:(?:number|no\.?|#|id)\s*[:#-]?|[:#])\s*([A-Z0-9-]{5,})\b/gi,
    (_match, claimNumber: string) => `claim #${maskIdentifierLast4(claimNumber)}`
  );
  output = output.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "");
  output = output.replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "");
  output = output.replace(
    /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl)\b\.?/gi,
    ""
  );
  output = output.replace(/\b(?:customer|owner|claimant|insured|policyholder|name)\s*[:#-]\s*[^,;\n]+/gi, "Vehicle Owner");
  if (/customer|claimant|owner|insured|policyholder/i.test(key)) {
    output = "Vehicle Owner";
  }
  if (/insurer|insurance/i.test(key) && !options.showInsurerName) {
    output = "[INSURER HIDDEN]";
  }
  if (/\bshop\b|repairFacility|bodyShop/i.test(key) && !options.showShopName) {
    output = "[SHOP HIDDEN]";
  }
  return output.replace(/\s{2,}/g, " ").trim();
}

function maskIdentifierLast4(value: string): string {
  const compact = value.replace(/[^A-Za-z0-9]/g, "");
  const last4 = compact.slice(-4);
  return last4 ? `*****${last4}` : "*****";
}

function cleanSnapshotText(value?: string | null): string | null {
  if (!value) return null;
  let output = toCustomerFacingText(value)
    .replace(/\s+/g, " ")
    .replace(/\bthe\s+the\b/gi, "the")
    .trim();
  for (const phrase of BANNED_GENERIC_PHRASES) {
    output = output.replace(new RegExp(escapeRegex(phrase), "gi"), "");
  }
  if (looksMalformedParserFragment(output)) return null;
  output = output.replace(/\s{2,}/g, " ").trim();
  return output || null;
}

function formatComparisonDelta(row: EstimateComparisonRow): string | null {
  const label =
    cleanSnapshotText(cleanOperationDisplayText(row.operation)) ||
    cleanSnapshotText(cleanOperationDisplayText(row.partName)) ||
    cleanSnapshotText(cleanOperationDisplayText(row.category)) ||
    "Estimate line";
  const delta = typeof row.delta === "number" ? `${row.delta > 0 ? "+" : ""}${row.delta}` : row.delta;
  const left = formatComparisonValue(row.lhsValue);
  const right = formatComparisonValue(row.rhsValue);
  const leftSource = /shop/i.test(`${row.lhsSource ?? ""}`) ? "shop estimate" : "left estimate";
  const rightSource = /carrier|insurer/i.test(`${row.rhsSource ?? ""}`) ? "carrier estimate" : "right estimate";
  const rawLabel = `${row.operation ?? ""} ${row.partName ?? ""} ${row.category ?? ""}`;

  if (!label || row.deltaType === "same") return null;
  if ((/^proc(?:edure)?$/i.test(label) || /\bproc(?:edure)?s?\b/i.test(rawLabel)) && right === "not shown") {
    return "Procedure item: present only in shop estimate.";
  }
  if (right === "not shown" && /present only in shop estimate/i.test(`${row.delta ?? ""}`)) {
    return `${label}: present only in shop estimate.`;
  }
  if (right === "not shown" && numericValue(left) !== undefined) {
    const unit = /hour|labor|reset|electrical|component/i.test(`${row.category ?? ""} ${row.operation ?? ""} ${row.partName ?? ""}`)
      ? " hrs"
      : "";
    return `${label}: ${left}${unit} in ${leftSource}; not clearly shown in ${rightSource}.`;
  }
  if (/body.*labor|labor/i.test(label)) return `Body labor: ${left} vs ${right}${delta ? ` (${delta})` : ""}`;
  if (/refinish|paint|material/i.test(label)) return `Refinish/materials: ${left} vs ${right}${delta ? ` (${delta})` : ""}`;
  if (/structural|measure|mechanical|calibration|scan|adas/i.test(label)) {
    return `${label}: ${left} vs ${right}${delta ? ` (${delta})` : ""}`;
  }
  return `${label}: ${left} vs ${right}${delta ? ` (${delta})` : ""}`;
}

function looksMalformedParserFragment(value: string): boolean {
  return (
    /\bProc\s*\d+\s*#?\*+/i.test(value) ||
    /\bwheelm\d+(?:\.\d+)?\b/i.test(value) ||
    /\bpark\s+park\s+park|park\s+sensor1ew63tzzaa1361/i.test(value) ||
    /\b[a-z]{3,}m\d+\.\d+\b/i.test(value) ||
    /[#*_|]{3,}/.test(value) ||
    value.split(/\s+/).filter(Boolean).length < 3 && /\d/.test(value)
  );
}

function formatComparisonValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || `${value}`.trim() === "") return "not shown";
  return typeof value === "number" ? `${value}` : String(value);
}

function numericValue(value: string | number | null | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const numeric = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(numeric) ? numeric : undefined;
}

function formatValuationRange(range?: { low: number; high: number }): string | undefined {
  if (!range || !Number.isFinite(range.low) || !Number.isFinite(range.high)) return undefined;
  return `${formatMoney(range.low)} - ${formatMoney(range.high)}`;
}

function formatMoney(value: number): string {
  const absolute = Math.abs(value);
  const formatted = absolute.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
  return value < 0 ? `-${formatted}` : formatted;
}

function formatLabel(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalizeKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function joinHumanList(values: string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
