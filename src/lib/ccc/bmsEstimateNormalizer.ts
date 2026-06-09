import type { VehicleIdentity } from "@/lib/ai/types/analysis";
import {
  buildCccBmsAiEstimateEvidenceContext,
  normalizeCccBmsEstimate as normalizeCccBmsEstimateCore,
  type CccBmsAiEstimateEvidenceContext,
  type CccBmsEstimateHeader,
  type CccBmsJurisdictionEvidenceCandidate,
  type CccBmsNormalizedLineItem,
} from "./cccBmsNormalizer";
import { CCC_SECURE_SHARE_EVIDENCE_RULE } from "./secureShareEvidenceRules";

export type CccBmsEstimateNormalizerOptions = {
  environment?: "sandbox" | "production";
  rqUid?: string | null;
  appId?: string | null;
  sourceEventId?: string | null;
};

export type NormalizedCccEstimate = {
  sourceSystem: "ccc_secure_share_bms";
  sourceConfidence: typeof CCC_SECURE_SHARE_EVIDENCE_RULE.sourceConfidence;
  environment: "sandbox" | "production" | null;
  appId: string | null;
  sourceEventId: string | null;
  rqUid: string | null;
  header: CccBmsEstimateHeader;
  vehicle: VehicleIdentity | null;
  vehicleReconciliationInput: VehicleIdentity | null;
  lineItems: CccBmsNormalizedLineItem[];
  jurisdictionEvidenceCandidates: CccBmsJurisdictionEvidenceCandidate[];
  aiContext: CccBmsAiEstimateEvidenceContext;
  evidenceBoundary: {
    authorityBoundary: typeof CCC_SECURE_SHARE_EVIDENCE_RULE.authorityBoundary;
    citationGapBoundary: typeof CCC_SECURE_SHARE_EVIDENCE_RULE.citationGapBoundary;
  };
  warnings: string[];
  limitations: string[];
};

export function normalizeCccBmsEstimate(
  xml: string,
  options: CccBmsEstimateNormalizerOptions = {}
): NormalizedCccEstimate {
  try {
    const normalized = normalizeCccBmsEstimateCore(xml);
    const rqUid = options.rqUid ?? normalized.header.rqUid;
    const header = {
      ...normalized.header,
      rqUid,
    };
    const estimate = {
      ...normalized,
      header,
    };

    return {
      sourceSystem: estimate.sourceSystem,
      sourceConfidence: estimate.sourceConfidence,
      environment: options.environment ?? null,
      appId: options.appId ?? null,
      sourceEventId: options.sourceEventId ?? null,
      rqUid,
      header,
      vehicle: estimate.vehicle,
      vehicleReconciliationInput: estimate.vehicleReconciliationInput,
      lineItems: estimate.lineItems,
      jurisdictionEvidenceCandidates: estimate.jurisdictionEvidenceCandidates,
      aiContext: buildCccBmsAiEstimateEvidenceContext(estimate),
      evidenceBoundary: {
        authorityBoundary: CCC_SECURE_SHARE_EVIDENCE_RULE.authorityBoundary,
        citationGapBoundary: CCC_SECURE_SHARE_EVIDENCE_RULE.citationGapBoundary,
      },
      warnings: dedupeMessages(estimate.parseWarnings),
      limitations: buildLimitations(estimate, xml),
    };
  } catch (error) {
    const warning =
      error instanceof Error
        ? `CCC BMS XML could not be normalized: ${error.message}`
        : "CCC BMS XML could not be normalized.";
    const fallback = buildEmptyNormalizedEstimate(options, [warning]);

    return fallback;
  }
}

function buildLimitations(
  estimate: ReturnType<typeof normalizeCccBmsEstimateCore>,
  xml: string
): string[] {
  const limitations: string[] = [
    "CCC BMS estimate data is estimate-source evidence only and is not OEM, P-page, DEG, legal, policy, or carrier-violation authority.",
  ];

  if (!xml.trim()) {
    limitations.push("No CCC BMS XML body was available to normalize.");
  }

  if (!estimate.header.estimateNumber && !estimate.header.estimateId) {
    limitations.push("Estimate identifier was not found in the CCC BMS XML.");
  }

  if (!estimate.header.claimNumber) {
    limitations.push("Claim number was not found in the CCC BMS XML.");
  }

  if (!estimate.vehicleReconciliationInput) {
    limitations.push("Vehicle identity fields were not found in the CCC BMS XML.");
  }

  if (estimate.lineItems.length === 0) {
    limitations.push("Line items were not found in recognized CCC/CIECA BMS line item blocks.");
  }

  return dedupeMessages(limitations);
}

function buildEmptyNormalizedEstimate(
  options: CccBmsEstimateNormalizerOptions,
  warnings: string[]
): NormalizedCccEstimate {
  const header = buildEmptyHeader(options.rqUid ?? null);
  const baseEstimate = {
    sourceSystem: "ccc_secure_share_bms" as const,
    sourceConfidence: CCC_SECURE_SHARE_EVIDENCE_RULE.sourceConfidence,
    header,
    vehicle: null,
    lineItems: [],
    jurisdictionEvidenceCandidates: [],
    vehicleReconciliationInput: null,
    parseWarnings: warnings,
  };

  return {
    sourceSystem: baseEstimate.sourceSystem,
    sourceConfidence: baseEstimate.sourceConfidence,
    environment: options.environment ?? null,
    appId: options.appId ?? null,
    sourceEventId: options.sourceEventId ?? null,
    rqUid: options.rqUid ?? null,
    header,
    vehicle: null,
    vehicleReconciliationInput: null,
    lineItems: [],
    jurisdictionEvidenceCandidates: [],
    aiContext: buildCccBmsAiEstimateEvidenceContext(baseEstimate),
    evidenceBoundary: {
      authorityBoundary: CCC_SECURE_SHARE_EVIDENCE_RULE.authorityBoundary,
      citationGapBoundary: CCC_SECURE_SHARE_EVIDENCE_RULE.citationGapBoundary,
    },
    warnings: dedupeMessages(warnings),
    limitations: buildLimitations(baseEstimate, ""),
  };
}

function buildEmptyHeader(rqUid: string | null): CccBmsEstimateHeader {
  return {
    rqUid,
    estimateId: null,
    estimateNumber: null,
    claimNumber: null,
    lossDate: null,
    estimateDate: null,
    supplementNumber: null,
    shopName: null,
    carrierName: null,
    ownerName: null,
    appraiserName: null,
    repairOrderNumber: null,
    totalAmount: null,
  };
}

function dedupeMessages(messages: string[]) {
  return [...new Set(messages.filter(Boolean))];
}
