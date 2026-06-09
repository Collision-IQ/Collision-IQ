import type {
  NormalizedCccEstimate,
  NormalizedCccEstimateLineItem,
} from "./bmsEstimateNormalizer";
import {
  CCC_SECURE_SHARE_EVIDENCE_RULE,
  classifyCccSecureShareEvidence,
} from "./secureShareEvidenceRules";

const DEFAULT_LINE_ITEM_LIMIT = 12;
const BANNED_CONTEXT_PHRASES = [
  "CCC confirms this operation is required",
  "CCC proves OEM requirement",
  "CCC proves P-page support",
  "CCC proves legal violation",
  "CCC proves policy coverage",
] as const;

export function buildCccEstimateEvidenceContext(
  normalized: NormalizedCccEstimate
): string {
  const context = [
    "[CCC Secure Share BMS Estimate Evidence]",
    "Estimate source: CCC Secure Share BMS",
    "Source confidence: high for estimate structure and line-item extraction",
    `Evidence lane: ${normalized.evidenceLane}`,
    `Environment: ${normalized.environment ?? "unknown"}`,
    `RqUID: ${normalized.rqUid ?? "not found"}`,
    buildIdentifierSummary(normalized),
    buildVehicleSummary(normalized),
    buildJurisdictionSummary(normalized),
    buildTotalsSummary(normalized),
    buildLineItemsSummary(normalized.lineItems),
    buildWarningsSummary("Parse warnings", normalized.parseWarnings),
    buildWarningsSummary("Limitations", normalized.limitations),
    "",
    classifyCccSecureShareEvidence("line_item_exists").reason,
    CCC_SECURE_SHARE_EVIDENCE_RULE.citationGapBoundary,
    "Do not use CCC Secure Share BMS as OEM, P-page, DEG, legal, policy, or carrier-violation authority.",
  ]
    .filter((line) => line !== null)
    .join("\n");

  return removeBannedPhrases(context);
}

function buildIdentifierSummary(normalized: NormalizedCccEstimate) {
  const identifiers = [
    `documentId=${normalized.identifiers.documentId ?? "unknown"}`,
    `workfileId=${normalized.identifiers.workfileId ?? "unknown"}`,
    `estimateId=${normalized.identifiers.estimateId ?? "unknown"}`,
    `estimateVersion=${normalized.identifiers.estimateVersion ?? "unknown"}`,
    `supplementNumber=${normalized.identifiers.supplementNumber ?? "unknown"}`,
    `claimNumberRedacted=${normalized.identifiers.claimNumberRedacted ?? "unknown"}`,
  ];

  return `Identifiers: ${identifiers.join("; ")}`;
}

function buildVehicleSummary(normalized: NormalizedCccEstimate) {
  const vehicle = normalized.vehicle;
  const identity = [
    vehicle.year,
    vehicle.make,
    vehicle.model,
    vehicle.trim,
  ]
    .filter(Boolean)
    .join(" ");
  const decoded = vehicle.decoded;

  return [
    "Vehicle:",
    `  summary: ${identity || "unknown"}`,
    `  vinTail: ${vehicle.vinTail ?? "unknown"}`,
    `  vinRedacted: ${vehicle.vinRedacted ?? "unknown"}`,
    `  mileage: ${formatNumber(vehicle.mileage)}`,
    `  decode: attempted=${decoded?.attempted ?? false}; source=${decoded?.source ?? "not_attempted"}; confidence=${decoded?.confidence ?? "unknown"}`,
    `  decode limitations: ${formatList(decoded?.limitations ?? [])}`,
  ].join("\n");
}

function buildJurisdictionSummary(normalized: NormalizedCccEstimate) {
  const resolution = normalized.jurisdictionResolution;
  const evidence = normalized.jurisdictionEvidence;

  return [
    "Jurisdiction:",
    `  resolvedState: ${resolution?.stateCode ?? resolution?.state ?? "unknown"}`,
    `  source: ${resolution?.source ?? "unknown"}`,
    `  confidence: ${resolution?.confidence ?? "unknown"}`,
    `  basis: ${resolution?.basis ?? "not resolved"}`,
    `  explicitState: ${evidence.explicitState ?? "none"}`,
    `  ownerAddressState: ${evidence.ownerAddressState ?? "none"}; ownerAddressZip: ${evidence.ownerAddressZip ?? "none"}; ownerAddressIsRealBlock: ${evidence.ownerAddressIsRealBlock}`,
    `  inspectionSiteState: ${evidence.inspectionSiteState ?? "none"}; inspectionSiteZip: ${evidence.inspectionSiteZip ?? "none"}`,
    `  repairFacilityState: ${evidence.repairFacilityState ?? "none"}; repairFacilityZip: ${evidence.repairFacilityZip ?? "none"}`,
    `  limitations: ${formatList([
      ...(resolution?.limitations ?? []),
      ...evidence.limitations,
    ])}`,
  ].join("\n");
}

function buildTotalsSummary(normalized: NormalizedCccEstimate) {
  const totals = normalized.totals;

  return [
    "Estimate totals:",
    `  grossTotal: ${formatNumber(totals.grossTotal)}`,
    `  netTotal: ${formatNumber(totals.netTotal)}`,
    `  deductible: ${formatNumber(totals.deductible)}`,
    `  tax: ${formatNumber(totals.tax)}`,
    `  laborTotal: ${formatNumber(totals.laborTotal)}`,
    `  partsTotal: ${formatNumber(totals.partsTotal)}`,
    `  paintMaterialsTotal: ${formatNumber(totals.paintMaterialsTotal)}`,
    `  subletTotal: ${formatNumber(totals.subletTotal)}`,
  ].join("\n");
}

function buildLineItemsSummary(lineItems: NormalizedCccEstimateLineItem[]) {
  const visibleItems = lineItems.slice(0, DEFAULT_LINE_ITEM_LIMIT);
  const omittedCount = Math.max(lineItems.length - visibleItems.length, 0);
  const rows = visibleItems.map(formatLineItem);

  return [
    `Top normalized line items: ${visibleItems.length} shown of ${lineItems.length}`,
    ...rows,
    omittedCount > 0 ? `  ... ${omittedCount} additional line item(s) omitted` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatLineItem(lineItem: NormalizedCccEstimateLineItem, index: number) {
  const label =
    lineItem.description ??
    lineItem.operation ??
    lineItem.partNumber ??
    "line item details not found";
  const details = [
    `line=${lineItem.lineNumber ?? index + 1}`,
    `section=${lineItem.section ?? lineItem.rawCategory ?? "unknown"}`,
    `operation=${lineItem.operation ?? "unknown"}`,
    `description=${label}`,
    `partNumber=${lineItem.partNumber ?? "unknown"}`,
    `partType=${lineItem.partType ?? "unknown"}`,
    `laborType=${lineItem.laborType ?? "unknown"}`,
    `quantity=${formatNumber(lineItem.quantity)}`,
    `laborHours=${formatNumber(lineItem.laborHours)}`,
    `paintLaborHours=${formatNumber(lineItem.paintLaborHours ?? lineItem.refinishHours)}`,
    `unitPrice=${formatNumber(lineItem.unitPrice)}`,
    `extendedAmount=${formatNumber(lineItem.extendedAmount)}`,
    `sourcePath=${lineItem.sourcePath ?? "unknown"}`,
  ];

  const warnings =
    lineItem.parseWarnings.length > 0
      ? `; warnings=${lineItem.parseWarnings.join(" | ")}`
      : "";

  return `  - ${details.join("; ")}${warnings}`;
}

function buildWarningsSummary(label: string, warnings: string[]) {
  return `${label}: ${formatList(warnings)}`;
}

function formatNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${value}` : "unknown";
}

function formatList(values: string[]) {
  const unique = [...new Set(values.filter(Boolean))];
  return unique.length > 0 ? unique.join(" | ") : "none";
}

function removeBannedPhrases(value: string) {
  return BANNED_CONTEXT_PHRASES.reduce(
    (next, phrase) => next.replaceAll(phrase, ""),
    value
  );
}
