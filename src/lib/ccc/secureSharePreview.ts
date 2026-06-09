import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";
import type {
  NormalizedCccEstimate,
  NormalizedCccEstimateLineItem,
} from "./bmsEstimateNormalizer";
import { CCC_SECURE_SHARE_EVIDENCE_RULE } from "./secureShareEvidenceRules";

const MAX_LINE_ITEM_PREVIEW_COUNT = 250;

export const CCC_SECURE_SHARE_HIGH_CONFIDENCE_BOUNDARY =
  "CCC Secure Share is high-confidence estimate evidence only. It is not OEM, P-page, DEG, legal, policy, or carrier-violation authority.";

const PROHIBITED_CCC_AUTHORITY_PHRASES = [
  "CCC confirms this operation is required",
  "CCC proves OEM",
  "CCC proves P-page",
  "CCC proves legal violation",
  "CCC proves policy coverage",
] as const;

export type CccSecureShareLineItemPreview = Pick<
  NormalizedCccEstimateLineItem,
  | "lineNumber"
  | "section"
  | "operation"
  | "description"
  | "laborType"
  | "partType"
  | "quantity"
  | "laborHours"
  | "bodyLaborHours"
  | "paintLaborHours"
  | "refinishHours"
  | "unitPrice"
  | "extendedAmount"
  | "parseWarnings"
>;

export type CccSecureShareNormalizedPreview = {
  normalizedHeaderJson: Record<string, unknown>;
  normalizedLineItemsPreviewJson: CccSecureShareLineItemPreview[];
  normalizedLineItemCount: number;
  normalizationStatus: "normalized" | "normalized_with_warnings";
  normalizationWarningsJson: string[];
  jurisdictionStateCode: string | null;
  jurisdictionSource: string | null;
  jurisdictionConfidence: string | null;
  vehicleYear: number | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleVinTail: string | null;
  vehicleVinHash: string | null;
  normalizedAt: Date;
};

export type CccSecureShareEventListItem = {
  id: string;
  receivedAt: string;
  environment: string;
  requestKind: string;
  rqUid: string | null;
  appId: string | null;
  trigger: string | null;
  bodyLength: number;
  contentType: string | null;
  sourceIp: string | null;
  signaturePresent: boolean;
  secretMatched: boolean;
  duplicate: boolean;
  normalizationStatus: string | null;
  normalizedLineItemCount: number | null;
  vehicle: {
    year: number | null;
    make: string | null;
    model: string | null;
    vinTail: string | null;
  };
  jurisdiction: {
    stateCode: string | null;
    source: string | null;
    confidence: string | null;
  };
  warningCount: number;
};

export type CccSecureShareEventDetail = CccSecureShareEventListItem & {
  normalizedHeader: Record<string, unknown> | null;
  jurisdictionEvidence: unknown;
  jurisdictionResolution: unknown;
  totals: unknown;
  lineItemPreview: CccSecureShareLineItemPreview[];
  parseWarnings: string[];
  normalizationWarnings: string[];
  aiSafeContextPreview: string | null;
  evidenceBoundaries: {
    linePresence: string;
    citationGap: string;
    authority: string;
  };
};

type AdminAccessResolver = () => Promise<{ isPlatformAdmin: boolean }>;
type PreviewReader = {
  list: (params: { limit: number }) => Promise<CccSecureShareEventListItem[]>;
  get: (id: string) => Promise<CccSecureShareEventDetail | null>;
};

let adminAccessResolverForTest: AdminAccessResolver | null = null;
let previewReaderForTest: PreviewReader | null = null;

export function setCccSecureSharePreviewAdminAccessResolverForTest(
  resolver: AdminAccessResolver | null
) {
  adminAccessResolverForTest = resolver;
}

export function setCccSecureSharePreviewReaderForTest(reader: PreviewReader | null) {
  previewReaderForTest = reader;
}

export async function requireCccSecureSharePreviewAdminAccess() {
  const access = adminAccessResolverForTest
    ? await adminAccessResolverForTest()
    : await requireCurrentUser();

  if (!access.isPlatformAdmin) {
    return { ok: false as const, status: 403, error: "Platform admin access is required." };
  }

  return { ok: true as const };
}

export function buildSanitizedCccSecureSharePreview(
  normalized: NormalizedCccEstimate
): CccSecureShareNormalizedPreview {
  const warnings = [...normalized.parseWarnings, ...normalized.limitations];
  const lineItems = normalized.lineItems
    .slice(0, MAX_LINE_ITEM_PREVIEW_COUNT)
    .map(sanitizeLineItemPreview);

  const header = compactObject({
    sourceSystem: normalized.sourceSystem,
    evidenceLane: normalized.evidenceLane,
    sourceConfidence: normalized.sourceConfidence,
    environment: normalized.environment ?? null,
    rqUid: normalized.rqUid ?? null,
    appId: normalized.appId ?? null,
    sourceEventId: normalized.sourceEventId ?? null,
    identifiers: compactObject({
      documentId: normalized.identifiers.documentId ?? null,
      workfileId: normalized.identifiers.workfileId ?? null,
      estimateId: normalized.identifiers.estimateId ?? null,
      estimateVersion: normalized.identifiers.estimateVersion ?? null,
      supplementNumber: normalized.identifiers.supplementNumber ?? null,
      claimNumberRedacted: normalized.identifiers.claimNumberRedacted ?? null,
      claimNumberHash: normalized.identifiers.claimNumberHash ?? null,
    }),
    vehicle: compactObject({
      year: normalized.vehicle.year ?? null,
      make: normalized.vehicle.make ?? null,
      model: normalized.vehicle.model ?? null,
      trim: normalized.vehicle.trim ?? null,
      mileage: normalized.vehicle.mileage ?? null,
      vinTail: normalized.vehicle.vinTail ?? null,
      vinHash: hashSensitiveValue(normalized.vehicle.vin),
      decoded: normalized.vehicle.decoded ?? null,
    }),
    totals: normalized.totals,
    jurisdictionEvidence: sanitizeJurisdictionEvidence(normalized),
    jurisdictionResolution: normalized.jurisdictionResolution ?? null,
    parseWarnings: normalized.parseWarnings,
    limitations: normalized.limitations,
    evidenceBoundary: CCC_SECURE_SHARE_HIGH_CONFIDENCE_BOUNDARY,
  });

  return {
    normalizedHeaderJson: header,
    normalizedLineItemsPreviewJson: lineItems,
    normalizedLineItemCount: normalized.lineItems.length,
    normalizationStatus: warnings.length > 0 ? "normalized_with_warnings" : "normalized",
    normalizationWarningsJson: warnings,
    jurisdictionStateCode: normalized.jurisdictionResolution?.stateCode ?? null,
    jurisdictionSource: normalized.jurisdictionResolution?.source ?? null,
    jurisdictionConfidence: normalized.jurisdictionResolution?.confidence ?? null,
    vehicleYear: normalized.vehicle.year ?? null,
    vehicleMake: normalized.vehicle.make ?? null,
    vehicleModel: normalized.vehicle.model ?? null,
    vehicleVinTail: normalized.vehicle.vinTail ?? null,
    vehicleVinHash: hashSensitiveValue(normalized.vehicle.vin),
    normalizedAt: new Date(),
  };
}

export async function persistCccSecureShareNormalizedPreview(
  eventId: string | null | undefined,
  preview: CccSecureShareNormalizedPreview
) {
  if (!eventId) return { persisted: false, reason: "missing_event_id" as const };

  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.cccSecureShareWebhookEvent.update({
      where: { id: eventId },
      data: {
        normalizedHeaderJson: preview.normalizedHeaderJson as Prisma.InputJsonValue,
        normalizedLineItemsPreviewJson:
          preview.normalizedLineItemsPreviewJson as Prisma.InputJsonValue,
        normalizedLineItemCount: preview.normalizedLineItemCount,
        normalizationStatus: preview.normalizationStatus,
        normalizationWarningsJson: preview.normalizationWarningsJson as Prisma.InputJsonValue,
        jurisdictionStateCode: preview.jurisdictionStateCode,
        jurisdictionSource: preview.jurisdictionSource,
        jurisdictionConfidence: preview.jurisdictionConfidence,
        vehicleYear: preview.vehicleYear,
        vehicleMake: preview.vehicleMake,
        vehicleModel: preview.vehicleModel,
        vehicleVinTail: preview.vehicleVinTail,
        vehicleVinHash: preview.vehicleVinHash,
        normalizedAt: preview.normalizedAt,
      },
    });

    return { persisted: true as const };
  } catch (error) {
    console.warn("[ccc-secure-share-preview] persistence skipped", {
      eventId,
      lineItemCount: preview.normalizedLineItemCount,
      normalizationStatus: preview.normalizationStatus,
      jurisdictionSource: preview.jurisdictionSource,
      jurisdictionConfidence: preview.jurisdictionConfidence,
      vehiclePresent: Boolean(preview.vehicleYear || preview.vehicleMake || preview.vehicleModel),
      warningCount: preview.normalizationWarningsJson.length,
      reason: isPrismaTableOrColumnMissingError(error) ? "schema_unavailable" : "persistence_error",
    });

    return { persisted: false as const, reason: "persistence_error" as const };
  }
}

export async function listCccSecureSharePreviewEvents(params: {
  limit?: number;
} = {}): Promise<CccSecureShareEventListItem[]> {
  if (previewReaderForTest) return previewReaderForTest.list({ limit: params.limit ?? 25 });

  const { prisma } = await import("@/lib/prisma");
  const limit = clampLimit(params.limit);
  const rows = await prisma.cccSecureShareWebhookEvent.findMany({
    orderBy: { receivedAt: "desc" },
    take: limit,
    select: listSelect,
  });

  return rows.map(mapListItem);
}

export async function getCccSecureSharePreviewEvent(
  id: string
): Promise<CccSecureShareEventDetail | null> {
  if (previewReaderForTest) return previewReaderForTest.get(id);

  const { prisma } = await import("@/lib/prisma");
  const row = await prisma.cccSecureShareWebhookEvent.findUnique({
    where: { id },
    select: detailSelect,
  });

  return row ? mapDetail(row) : null;
}

function sanitizeLineItemPreview(
  lineItem: NormalizedCccEstimateLineItem
): CccSecureShareLineItemPreview {
  return compactObject({
    lineNumber: lineItem.lineNumber ?? null,
    section: lineItem.section ?? null,
    operation: lineItem.operation ?? null,
    description: lineItem.description ?? null,
    laborType: lineItem.laborType ?? null,
    partType: lineItem.partType ?? null,
    quantity: lineItem.quantity ?? null,
    laborHours: lineItem.laborHours ?? null,
    bodyLaborHours: lineItem.bodyLaborHours ?? null,
    paintLaborHours: lineItem.paintLaborHours ?? null,
    refinishHours: lineItem.refinishHours ?? null,
    unitPrice: lineItem.unitPrice ?? null,
    extendedAmount: lineItem.extendedAmount ?? null,
    parseWarnings: lineItem.parseWarnings,
  }) as CccSecureShareLineItemPreview;
}

function sanitizeJurisdictionEvidence(normalized: NormalizedCccEstimate) {
  const evidence = normalized.jurisdictionEvidence;
  return {
    explicitState: evidence.explicitState ?? null,
    policyState: evidence.policyState ?? null,
    ownerAddressState: evidence.ownerAddressState ?? null,
    ownerAddressZipPresent: Boolean(evidence.ownerAddressZip),
    ownerAddressIsRealBlock: evidence.ownerAddressIsRealBlock,
    inspectionSiteState: evidence.inspectionSiteState ?? null,
    inspectionSiteZip: evidence.inspectionSiteZip ?? null,
    repairFacilityState: evidence.repairFacilityState ?? null,
    repairFacilityZip: evidence.repairFacilityZip ?? null,
    limitations: evidence.limitations,
  };
}

function hashSensitiveValue(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? createHash("sha256").update(trimmed).digest("hex") : null;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

function clampLimit(limit: number | undefined) {
  if (!Number.isFinite(limit ?? NaN)) return 25;
  return Math.min(Math.max(Math.trunc(limit as number), 1), 100);
}

const listSelect = {
  id: true,
  receivedAt: true,
  environment: true,
  requestKind: true,
  rqUid: true,
  appId: true,
  trigger: true,
  bodyLength: true,
  contentType: true,
  sourceIp: true,
  signaturePresent: true,
  secretMatched: true,
  duplicate: true,
  normalizationStatus: true,
  normalizedLineItemCount: true,
  normalizationWarningsJson: true,
  vehicleYear: true,
  vehicleMake: true,
  vehicleModel: true,
  vehicleVinTail: true,
  jurisdictionStateCode: true,
  jurisdictionSource: true,
  jurisdictionConfidence: true,
} as const;

const detailSelect = {
  ...listSelect,
  normalizedHeaderJson: true,
  normalizedLineItemsPreviewJson: true,
} as const;

function mapListItem(row: {
  id: string;
  receivedAt: Date;
  environment: string;
  requestKind: string;
  rqUid: string | null;
  appId: string | null;
  trigger: string | null;
  bodyLength: number;
  contentType: string | null;
  sourceIp: string | null;
  signaturePresent: boolean;
  secretMatched: boolean;
  duplicate: boolean;
  normalizationStatus: string | null;
  normalizedLineItemCount: number | null;
  normalizationWarningsJson: unknown;
  vehicleYear: number | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleVinTail: string | null;
  jurisdictionStateCode: string | null;
  jurisdictionSource: string | null;
  jurisdictionConfidence: string | null;
}): CccSecureShareEventListItem {
  return {
    id: row.id,
    receivedAt: row.receivedAt.toISOString(),
    environment: row.environment,
    requestKind: row.requestKind,
    rqUid: row.rqUid,
    appId: row.appId,
    trigger: row.trigger,
    bodyLength: row.bodyLength,
    contentType: row.contentType,
    sourceIp: row.sourceIp,
    signaturePresent: row.signaturePresent,
    secretMatched: row.secretMatched,
    duplicate: row.duplicate,
    normalizationStatus: row.normalizationStatus,
    normalizedLineItemCount: row.normalizedLineItemCount,
    vehicle: {
      year: row.vehicleYear,
      make: row.vehicleMake,
      model: row.vehicleModel,
      vinTail: row.vehicleVinTail,
    },
    jurisdiction: {
      stateCode: row.jurisdictionStateCode,
      source: row.jurisdictionSource,
      confidence: row.jurisdictionConfidence,
    },
    warningCount: asStringArray(row.normalizationWarningsJson).length,
  };
}

function mapDetail(
  row: Parameters<typeof mapListItem>[0] & {
    normalizedHeaderJson: unknown;
    normalizedLineItemsPreviewJson: unknown;
  }
): CccSecureShareEventDetail {
  const listItem = mapListItem(row);
  const header = asRecord(row.normalizedHeaderJson);
  const lineItems = asLineItems(row.normalizedLineItemsPreviewJson);
  const parseWarnings = asStringArray(header?.parseWarnings);
  const normalizationWarnings = asStringArray(row.normalizationWarningsJson);

  return {
    ...listItem,
    normalizedHeader: header,
    jurisdictionEvidence: header?.jurisdictionEvidence ?? null,
    jurisdictionResolution: header?.jurisdictionResolution ?? null,
    totals: header?.totals ?? null,
    lineItemPreview: lineItems,
    parseWarnings,
    normalizationWarnings,
    aiSafeContextPreview: buildAiSafePreviewFromStoredHeader(header, lineItems),
    evidenceBoundaries: {
      linePresence:
        "CCC Secure Share source confirms this estimate line was present in the structured estimate data.",
      citationGap: CCC_SECURE_SHARE_EVIDENCE_RULE.citationGapBoundary,
      authority: CCC_SECURE_SHARE_HIGH_CONFIDENCE_BOUNDARY,
    },
  };
}

function buildAiSafePreviewFromStoredHeader(
  header: Record<string, unknown> | null,
  lineItems: CccSecureShareLineItemPreview[]
) {
  if (!header) return null;

  const context = [
    "Estimate source: CCC Secure Share BMS",
    "Source confidence: high for estimate structure and line-item extraction",
    `Evidence lane: ${header.evidenceLane ?? "estimate_evidence"}`,
    `Vehicle: ${formatVehicleSummary(header.vehicle)}`,
    `Jurisdiction source: ${formatJurisdictionSource(header.jurisdictionResolution)}`,
    `Line items previewed: ${lineItems.length}`,
    "CCC Secure Share source confirms this estimate line was present in the structured estimate data.",
    CCC_SECURE_SHARE_EVIDENCE_RULE.citationGapBoundary,
    CCC_SECURE_SHARE_HIGH_CONFIDENCE_BOUNDARY,
  ].join("\n");

  return removeProhibitedPhrases(context);
}

function formatVehicleSummary(vehicle: unknown) {
  const record = asRecord(vehicle);
  if (!record) return "unknown";
  return [record.year, record.make, record.model, record.trim].filter(Boolean).join(" ") || "unknown";
}

function formatJurisdictionSource(resolution: unknown) {
  const record = asRecord(resolution);
  if (!record) return "unknown";
  return `${record.source ?? "unknown"}; confidence=${record.confidence ?? "unknown"}`;
}

function removeProhibitedPhrases(value: string) {
  return PROHIBITED_CCC_AUTHORITY_PHRASES.reduce(
    (current, phrase) => current.replaceAll(phrase, ""),
    value
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function asLineItems(value: unknown): CccSecureShareLineItemPreview[] {
  return Array.isArray(value) ? (value as CccSecureShareLineItemPreview[]) : [];
}

function isPrismaTableOrColumnMissingError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      ((error as { code?: unknown }).code === "P2021" ||
        (error as { code?: unknown }).code === "P2022")
  );
}

export { UnauthorizedError };
