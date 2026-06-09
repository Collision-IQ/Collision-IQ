import type { VehicleIdentity } from "@/lib/ai/types/analysis";
import {
  CCC_SECURE_SHARE_ALLOWED_PROOF_CAPABILITIES,
  CCC_SECURE_SHARE_EVIDENCE_RULE,
  CCC_SECURE_SHARE_PROHIBITED_PROOF_CATEGORIES,
  type CccSecureShareProofCapability,
} from "./secureShareEvidenceRules";

export type CccBmsEstimateHeader = {
  rqUid: string | null;
  estimateId: string | null;
  estimateNumber: string | null;
  claimNumber: string | null;
  lossDate: string | null;
  estimateDate: string | null;
  supplementNumber: string | null;
  shopName: string | null;
  carrierName: string | null;
  ownerName: string | null;
  appraiserName: string | null;
  repairOrderNumber: string | null;
  totalAmount: number | null;
};

export type CccBmsNormalizedLineItem = {
  id: string;
  lineNumber: string | null;
  operation: string | null;
  component: string | null;
  description: string | null;
  partNumber: string | null;
  laborType: string | null;
  laborHours: number | null;
  laborAmount: number | null;
  paintHours: number | null;
  paintAmount: number | null;
  partAmount: number | null;
  totalAmount: number | null;
  sourcePath: string;
  evidenceCapabilities: CccSecureShareProofCapability[];
};

export type CccBmsJurisdictionEvidenceCandidate = {
  field: "lossState" | "repairState" | "ownerState" | "claimNumber" | "carrierName";
  value: string;
  source: "ccc_bms_estimate_header";
  confidence: "structured_estimate_metadata";
  proofCapability: Extract<CccSecureShareProofCapability, "structured_estimate_metadata">;
};

export type CccBmsNormalizedEstimate = {
  sourceSystem: "ccc_secure_share_bms";
  sourceConfidence: typeof CCC_SECURE_SHARE_EVIDENCE_RULE.sourceConfidence;
  header: CccBmsEstimateHeader;
  vehicle: VehicleIdentity | null;
  lineItems: CccBmsNormalizedLineItem[];
  jurisdictionEvidenceCandidates: CccBmsJurisdictionEvidenceCandidate[];
  vehicleReconciliationInput: VehicleIdentity | null;
  parseWarnings: string[];
};

export type CccBmsAiEstimateEvidenceContext = {
  sourceSystem: "ccc_secure_share_bms";
  sourceConfidence: typeof CCC_SECURE_SHARE_EVIDENCE_RULE.sourceConfidence;
  authorityBoundary: typeof CCC_SECURE_SHARE_EVIDENCE_RULE.authorityBoundary;
  citationGapBoundary: typeof CCC_SECURE_SHARE_EVIDENCE_RULE.citationGapBoundary;
  allowedProofCapabilities: typeof CCC_SECURE_SHARE_ALLOWED_PROOF_CAPABILITIES;
  prohibitedProofCategories: typeof CCC_SECURE_SHARE_PROHIBITED_PROOF_CATEGORIES;
  header: CccBmsEstimateHeader;
  vehicleReconciliationInput: VehicleIdentity | null;
  jurisdictionEvidenceCandidates: CccBmsJurisdictionEvidenceCandidate[];
  lineItems: CccBmsNormalizedLineItem[];
  parseWarnings: string[];
  aiUse: {
    mayUseFor: string[];
    mustNotUseFor: string[];
  };
};

type XmlBlock = {
  localName: string;
  content: string;
  sourcePath: string;
};

const HEADER_FIELD_ALIASES = {
  rqUid: ["RqUID"],
  estimateId: ["EstimateID", "EstimateId", "DocumentID", "DocumentId"],
  estimateNumber: ["EstimateNumber", "EstimateNum", "EstimateNo"],
  claimNumber: ["ClaimNumber", "ClaimNum", "ClaimNo"],
  lossDate: ["LossDate", "DateOfLoss"],
  estimateDate: ["EstimateDate", "CreateDate", "CreationDate"],
  supplementNumber: ["SupplementNumber", "SupplementNum", "SupplementNo"],
  shopName: ["RepairFacilityName", "ShopName", "RepairerName", "OrganizationName"],
  carrierName: ["InsuranceCompanyName", "InsurerName", "CarrierName"],
  ownerName: ["OwnerName", "CustomerName", "ClaimantName"],
  appraiserName: ["AppraiserName", "EstimatorName"],
  repairOrderNumber: ["RepairOrderNumber", "RONumber", "RepairOrderNo"],
  totalAmount: ["TotalAmt", "TotalAmount", "GrandTotal"],
} as const;

const VEHICLE_FIELD_ALIASES = {
  year: ["ModelYear", "VehicleYear", "Year"],
  make: ["Make", "VehicleMake"],
  model: ["Model", "VehicleModel"],
  vin: ["VIN", "Vin", "VehicleIdentificationNumber"],
  trim: ["Trim", "Series", "SubModel"],
  bodyStyle: ["BodyStyle", "BodyType"],
} as const;

const LINE_ITEM_TAG_NAME_PATTERNS = [
  /EstimateLine/i,
  /LineItem/i,
  /DamageLine/i,
  /Operation/i,
  /Part/i,
  /Labor/i,
  /OtherCharge/i,
] as const;

const LINE_FIELD_ALIASES = {
  lineNumber: ["LineNumber", "LineNum", "LineNo", "SequenceNumber"],
  operation: ["Operation", "OperationCode", "OpCode", "OperationDescription"],
  component: ["PartDescription", "Component", "ComponentName", "Panel", "PartName"],
  description: ["Description", "LineDescription", "OperationDescription", "PartDescription"],
  partNumber: ["PartNumber", "PartNum", "OEMPartNumber"],
  laborType: ["LaborType", "LaborCategory"],
  laborHours: ["LaborHours", "BodyLaborHours", "MechLaborHours", "FrameLaborHours"],
  laborAmount: ["LaborAmt", "LaborAmount"],
  paintHours: ["PaintHours", "RefinishHours"],
  paintAmount: ["PaintAmt", "PaintAmount", "RefinishAmount"],
  partAmount: ["PartAmt", "PartAmount"],
  totalAmount: ["TotalAmt", "TotalAmount", "LineTotal", "ExtendedAmount", "ExtendedAmt", "Amount"],
} as const;

const JURISDICTION_FIELD_ALIASES = {
  lossState: ["LossState", "LossStateProvince", "AccidentState"],
  repairState: ["RepairFacilityState", "ShopState", "RepairState"],
  ownerState: ["OwnerState", "CustomerState", "ClaimantState"],
} as const;

export function normalizeCccBmsEstimate(xml: string): CccBmsNormalizedEstimate {
  const parseWarnings: string[] = [];
  const header = buildHeader(xml);
  const vehicle = buildVehicleIdentity(xml);
  const lineItems = extractLineItemBlocks(xml).map((block, index) =>
    buildLineItem(block, index)
  );

  if (!xml.trim()) {
    parseWarnings.push("CCC BMS XML body is empty.");
  }

  if (!header.rqUid) {
    parseWarnings.push("RqUID was not found in CCC BMS XML.");
  }

  if (lineItems.length === 0) {
    parseWarnings.push("No CCC BMS line item blocks were found.");
  }

  return {
    sourceSystem: "ccc_secure_share_bms",
    sourceConfidence: CCC_SECURE_SHARE_EVIDENCE_RULE.sourceConfidence,
    header,
    vehicle,
    lineItems,
    jurisdictionEvidenceCandidates: buildJurisdictionEvidenceCandidates(xml, header),
    vehicleReconciliationInput: vehicle,
    parseWarnings,
  };
}

export function buildCccBmsAiEstimateEvidenceContext(
  estimate: CccBmsNormalizedEstimate
): CccBmsAiEstimateEvidenceContext {
  return {
    sourceSystem: estimate.sourceSystem,
    sourceConfidence: estimate.sourceConfidence,
    authorityBoundary: CCC_SECURE_SHARE_EVIDENCE_RULE.authorityBoundary,
    citationGapBoundary: CCC_SECURE_SHARE_EVIDENCE_RULE.citationGapBoundary,
    allowedProofCapabilities: CCC_SECURE_SHARE_ALLOWED_PROOF_CAPABILITIES,
    prohibitedProofCategories: CCC_SECURE_SHARE_PROHIBITED_PROOF_CATEGORIES,
    header: estimate.header,
    vehicleReconciliationInput: estimate.vehicleReconciliationInput,
    jurisdictionEvidenceCandidates: estimate.jurisdictionEvidenceCandidates,
    lineItems: estimate.lineItems,
    parseWarnings: estimate.parseWarnings,
    aiUse: {
      mayUseFor: [
        "estimate header facts",
        "line item existence",
        "line item amount, hour, and operation metadata",
        "vehicle, claim, shop, and carrier metadata from structured estimate data",
        "estimate deltas when compared to another estimate",
      ],
      mustNotUseFor: [
        "OEM-required procedure proof",
        "P-page included or not-included proof",
        "DEG support proof",
        "legal or regulatory authority",
        "policy coverage or exclusion proof",
        "carrier violation proof",
      ],
    },
  };
}

export function normalizeCccBmsEstimateForAi(xml: string): CccBmsAiEstimateEvidenceContext {
  return buildCccBmsAiEstimateEvidenceContext(normalizeCccBmsEstimate(xml));
}

function buildHeader(xml: string): CccBmsEstimateHeader {
  return {
    rqUid: firstText(xml, HEADER_FIELD_ALIASES.rqUid),
    estimateId: firstText(xml, HEADER_FIELD_ALIASES.estimateId),
    estimateNumber: firstText(xml, HEADER_FIELD_ALIASES.estimateNumber),
    claimNumber: firstText(xml, HEADER_FIELD_ALIASES.claimNumber),
    lossDate: firstText(xml, HEADER_FIELD_ALIASES.lossDate),
    estimateDate: firstText(xml, HEADER_FIELD_ALIASES.estimateDate),
    supplementNumber: firstText(xml, HEADER_FIELD_ALIASES.supplementNumber),
    shopName: firstText(xml, HEADER_FIELD_ALIASES.shopName),
    carrierName: firstText(xml, HEADER_FIELD_ALIASES.carrierName),
    ownerName: firstText(xml, HEADER_FIELD_ALIASES.ownerName),
    appraiserName: firstText(xml, HEADER_FIELD_ALIASES.appraiserName),
    repairOrderNumber: firstText(xml, HEADER_FIELD_ALIASES.repairOrderNumber),
    totalAmount: parseNumber(firstText(xml, HEADER_FIELD_ALIASES.totalAmount)),
  };
}

function buildVehicleIdentity(xml: string): VehicleIdentity | null {
  const vehicle: VehicleIdentity = {
    year: parseInteger(firstText(xml, VEHICLE_FIELD_ALIASES.year)),
    make: firstText(xml, VEHICLE_FIELD_ALIASES.make) ?? undefined,
    model: firstText(xml, VEHICLE_FIELD_ALIASES.model) ?? undefined,
    vin: firstText(xml, VEHICLE_FIELD_ALIASES.vin)?.toUpperCase() ?? undefined,
    trim: firstText(xml, VEHICLE_FIELD_ALIASES.trim) ?? undefined,
    bodyStyle: firstText(xml, VEHICLE_FIELD_ALIASES.bodyStyle) ?? undefined,
    confidence: 0.86,
    source: "attachment",
    fieldSources: {
      year: "attachment",
      make: "attachment",
      model: "attachment",
      vin: "attachment",
      trim: "attachment",
      bodyStyle: "attachment",
    },
  };

  if (
    !vehicle.year &&
    !vehicle.make &&
    !vehicle.model &&
    !vehicle.vin &&
    !vehicle.trim &&
    !vehicle.bodyStyle
  ) {
    return null;
  }

  return vehicle;
}

function buildLineItem(block: XmlBlock, index: number): CccBmsNormalizedLineItem {
  const lineNumber = firstText(block.content, LINE_FIELD_ALIASES.lineNumber);
  const operation = firstText(block.content, LINE_FIELD_ALIASES.operation);
  const component = firstText(block.content, LINE_FIELD_ALIASES.component);
  const description = firstText(block.content, LINE_FIELD_ALIASES.description);

  return {
    id: lineNumber ? `ccc-line-${lineNumber}` : `ccc-line-${index + 1}`,
    lineNumber,
    operation,
    component,
    description,
    partNumber: firstText(block.content, LINE_FIELD_ALIASES.partNumber),
    laborType: firstText(block.content, LINE_FIELD_ALIASES.laborType),
    laborHours: parseNumber(firstText(block.content, LINE_FIELD_ALIASES.laborHours)),
    laborAmount: parseNumber(firstText(block.content, LINE_FIELD_ALIASES.laborAmount)),
    paintHours: parseNumber(firstText(block.content, LINE_FIELD_ALIASES.paintHours)),
    paintAmount: parseNumber(firstText(block.content, LINE_FIELD_ALIASES.paintAmount)),
    partAmount: parseNumber(firstText(block.content, LINE_FIELD_ALIASES.partAmount)),
    totalAmount: parseNumber(firstText(block.content, LINE_FIELD_ALIASES.totalAmount)),
    sourcePath: block.sourcePath || `/VehicleDamageEstimateAddRq/${block.localName}[${index + 1}]`,
    evidenceCapabilities: ["line_item_exists", "line_item_changed"],
  };
}

function buildJurisdictionEvidenceCandidates(
  xml: string,
  header: CccBmsEstimateHeader
): CccBmsJurisdictionEvidenceCandidate[] {
  const candidates: CccBmsJurisdictionEvidenceCandidate[] = [];

  for (const [field, aliases] of Object.entries(JURISDICTION_FIELD_ALIASES)) {
    const value = firstText(xml, aliases);
    if (value) {
      candidates.push({
        field: field as CccBmsJurisdictionEvidenceCandidate["field"],
        value,
        source: "ccc_bms_estimate_header",
        confidence: "structured_estimate_metadata",
        proofCapability: "structured_estimate_metadata",
      });
    }
  }

  if (header.claimNumber) {
    candidates.push({
      field: "claimNumber",
      value: header.claimNumber,
      source: "ccc_bms_estimate_header",
      confidence: "structured_estimate_metadata",
      proofCapability: "structured_estimate_metadata",
    });
  }

  if (header.carrierName) {
    candidates.push({
      field: "carrierName",
      value: header.carrierName,
      source: "ccc_bms_estimate_header",
      confidence: "structured_estimate_metadata",
      proofCapability: "structured_estimate_metadata",
    });
  }

  return candidates;
}

function extractLineItemBlocks(xml: string): XmlBlock[] {
  const blocks: XmlBlock[] = [];
  const seen = new Set<string>();
  const occurrenceByTag = new Map<string, number>();
  const candidateLocalNames = collectCandidateLineTagNames(xml);

  for (const localName of candidateLocalNames) {
    const pattern = new RegExp(
      `<(?:[\\w.-]+:)?${escapeRegExp(localName)}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${escapeRegExp(localName)}>`,
      "gi"
    );
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(xml))) {
      const content = match[1] ?? "";
      if (!isLineLikeElement(localName, content)) continue;

      const occurrence = (occurrenceByTag.get(localName) ?? 0) + 1;
      occurrenceByTag.set(localName, occurrence);
      const sourcePath = `/VehicleDamageEstimateAddRq/${localName}[${occurrence}]`;
      const key = `${localName}:${match.index}:${content.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      blocks.push({ localName, content, sourcePath });
    }
  }

  return blocks;
}

function collectCandidateLineTagNames(xml: string) {
  const names = new Set<string>();
  const pattern = /<(?<tag>(?:[\w.-]+:)?(?<localName>[\w.-]+))\b(?![^>]*\/>)[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) {
    const localName = match.groups?.localName ?? "";
    if (LINE_ITEM_TAG_NAME_PATTERNS.some((linePattern) => linePattern.test(localName))) {
      names.add(localName);
    }
  }
  return [...names];
}

function isLineLikeElement(localName: string, content: string) {
  if (!LINE_ITEM_TAG_NAME_PATTERNS.some((pattern) => pattern.test(localName))) {
    return false;
  }

  if (!/<(?:[\w.-]+:)?[\w.-]+\b[^>]*>/.test(content)) {
    return false;
  }

  const lineSignals = [
    LINE_FIELD_ALIASES.lineNumber,
    LINE_FIELD_ALIASES.operation,
    LINE_FIELD_ALIASES.component,
    LINE_FIELD_ALIASES.description,
    LINE_FIELD_ALIASES.partNumber,
    LINE_FIELD_ALIASES.laborType,
    LINE_FIELD_ALIASES.laborHours,
    LINE_FIELD_ALIASES.paintHours,
    LINE_FIELD_ALIASES.totalAmount,
  ].filter((aliases) => firstText(content, aliases));

  return lineSignals.length > 0;
}

function firstText(xml: string, localNames: readonly string[]): string | null {
  for (const localName of localNames) {
    const pattern = new RegExp(
      `<(?:[\\w.-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${localName}>`,
      "i"
    );
    const value = decodeXmlEntities(stripXmlTags(pattern.exec(xml)?.[1] ?? "")).trim();
    if (value) {
      return value;
    }
  }

  return null;
}

function stripXmlTags(value: string) {
  return value.replace(/<[^>]+>/g, " ");
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

function parseNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: string | null): number | undefined {
  const parsed = parseNumber(value);
  return typeof parsed === "number" ? Math.trunc(parsed) : undefined;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
