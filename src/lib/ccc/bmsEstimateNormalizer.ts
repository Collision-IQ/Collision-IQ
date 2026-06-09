import { createHash } from "node:crypto";
import {
  normalizeStateCode,
  resolveJurisdiction,
  stateFromZip,
  type ResolvedJurisdiction,
} from "@/lib/ai/jurisdictionResolver";
import type { VehicleIdentity } from "@/lib/ai/types/analysis";
import {
  decodeVinVehicleIdentity,
  normalizeVehicleIdentity,
} from "@/lib/ai/vehicleContext";
import {
  normalizeCccBmsEstimate as normalizeCccBmsEstimateCore,
  type CccBmsNormalizedLineItem,
} from "./cccBmsNormalizer";

export type CccBmsEstimateNormalizerOptions = {
  environment?: "sandbox" | "production";
  rqUid?: string | null;
  appId?: string | null;
  sourceEventId?: string | null;
};

type NormalizedCccJurisdictionResolution = NonNullable<
  NormalizedCccEstimate["jurisdictionResolution"]
>;

export type AddressParty = {
  name?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  rawLabel?: string | null;
  hasRealAddressBlock: boolean;
};

export type NormalizedCccEstimateLineItem = {
  sourceSystem: "ccc_secure_share_bms";
  evidenceLane: "estimate_evidence";
  sourceConfidence: "high";
  lineNumber?: string | null;
  section?: string | null;
  operation?: string | null;
  description?: string | null;
  partNumber?: string | null;
  partType?: string | null;
  laborType?: string | null;
  quantity?: number | null;
  laborHours?: number | null;
  bodyLaborHours?: number | null;
  paintLaborHours?: number | null;
  mechanicalLaborHours?: number | null;
  frameLaborHours?: number | null;
  refinishHours?: number | null;
  unitPrice?: number | null;
  extendedAmount?: number | null;
  tax?: number | null;
  includedFlag?: boolean | null;
  manualEntry?: boolean | null;
  betterment?: number | null;
  rawCategory?: string | null;
  sourcePath?: string | null;
  parseWarnings: string[];
};

export type NormalizedCccEstimate = {
  sourceSystem: "ccc_secure_share_bms";
  evidenceLane: "estimate_evidence";
  sourceConfidence: "high";
  environment?: "sandbox" | "production";
  rqUid?: string | null;
  appId?: string | null;
  sourceEventId?: string | null;
  identifiers: {
    documentId?: string | null;
    workfileId?: string | null;
    estimateId?: string | null;
    estimateVersion?: string | null;
    supplementNumber?: string | null;
    claimNumber?: string | null;
    claimNumberRedacted?: string | null;
    claimNumberHash?: string | null;
  };
  vehicle: {
    vin?: string | null;
    vinRedacted?: string | null;
    vinTail?: string | null;
    year?: number | null;
    make?: string | null;
    model?: string | null;
    trim?: string | null;
    mileage?: number | null;
    decoded?: {
      attempted: boolean;
      source: "ccc_bms" | "existing_vin_decoder" | "not_attempted";
      confidence: "low" | "medium" | "high" | "unknown";
      limitations: string[];
    };
  };
  parties: {
    repairFacility?: AddressParty | null;
    inspectionSite?: AddressParty | null;
    appraiser?: AddressParty | null;
    owner?: AddressParty | null;
    insured?: AddressParty | null;
    claimant?: AddressParty | null;
    insurer?: {
      name?: string | null;
      payerType?: string | null;
    } | null;
  };
  totals: {
    grossTotal?: number | null;
    netTotal?: number | null;
    deductible?: number | null;
    tax?: number | null;
    laborTotal?: number | null;
    partsTotal?: number | null;
    paintMaterialsTotal?: number | null;
    subletTotal?: number | null;
  };
  jurisdictionEvidence: {
    explicitState?: string | null;
    policyState?: string | null;
    ownerAddressState?: string | null;
    ownerAddressZip?: string | null;
    ownerAddressIsRealBlock: boolean;
    inspectionSiteState?: string | null;
    inspectionSiteZip?: string | null;
    repairFacilityState?: string | null;
    repairFacilityZip?: string | null;
    limitations: string[];
  };
  jurisdictionResolution?: {
    state?: string | null;
    stateCode?: string | null;
    source?: string | null;
    confidence?: "low" | "medium" | "high" | "unknown";
    basis?: string | null;
    limitations?: string[];
  };
  lineItems: NormalizedCccEstimateLineItem[];
  parseWarnings: string[];
  limitations: string[];
};

const IDENTIFIER_ALIASES = {
  documentId: ["DocumentID", "DocumentId", "DocumentNumber"],
  workfileId: ["WorkfileID", "WorkfileId", "WorkfileNumber"],
  estimateVersion: ["EstimateVersion", "VersionNumber", "RevisionNumber"],
} as const;

const PARTY_ALIASES = {
  repairFacility: {
    name: ["RepairFacilityName", "ShopName", "RepairerName"],
    address1: ["RepairFacilityAddress1", "ShopAddress1"],
    address2: ["RepairFacilityAddress2", "ShopAddress2"],
    city: ["RepairFacilityCity", "ShopCity"],
    state: ["RepairFacilityState", "ShopState", "RepairState"],
    zip: ["RepairFacilityZip", "RepairFacilityPostalCode", "ShopZip"],
  },
  inspectionSite: {
    name: ["InspectionSiteName"],
    address1: ["InspectionSiteAddress1"],
    address2: ["InspectionSiteAddress2"],
    city: ["InspectionSiteCity"],
    state: ["InspectionSiteState"],
    zip: ["InspectionSiteZip", "InspectionSitePostalCode"],
  },
  owner: {
    name: ["OwnerName", "CustomerName"],
    address1: ["OwnerAddress1", "CustomerAddress1"],
    address2: ["OwnerAddress2", "CustomerAddress2"],
    city: ["OwnerCity", "CustomerCity"],
    state: ["OwnerState", "CustomerState"],
    zip: ["OwnerZip", "OwnerPostalCode", "CustomerZip"],
  },
  insured: {
    name: ["InsuredName"],
    address1: ["InsuredAddress1"],
    address2: ["InsuredAddress2"],
    city: ["InsuredCity"],
    state: ["InsuredState"],
    zip: ["InsuredZip", "InsuredPostalCode"],
  },
  claimant: {
    name: ["ClaimantName"],
    address1: ["ClaimantAddress1"],
    address2: ["ClaimantAddress2"],
    city: ["ClaimantCity"],
    state: ["ClaimantState"],
    zip: ["ClaimantZip", "ClaimantPostalCode"],
  },
  appraiser: {
    name: ["AppraiserName", "EstimatorName"],
    address1: ["AppraiserAddress1"],
    address2: ["AppraiserAddress2"],
    city: ["AppraiserCity"],
    state: ["AppraiserState"],
    zip: ["AppraiserZip", "AppraiserPostalCode"],
  },
} as const;

const TOTAL_ALIASES = {
  grossTotal: ["GrossTotal", "GrossTotalAmt", "TotalAmount", "TotalAmt", "GrandTotal"],
  netTotal: ["NetTotal", "NetTotalAmt"],
  deductible: ["Deductible", "DeductibleAmt", "DeductibleAmount"],
  tax: ["Tax", "TaxAmt", "TaxAmount", "TotalTax"],
  laborTotal: ["LaborTotal", "LaborTotalAmt", "TotalLabor"],
  partsTotal: ["PartsTotal", "PartsTotalAmt", "TotalParts"],
  paintMaterialsTotal: ["PaintMaterialsTotal", "PaintMaterialTotal", "PaintMaterialsAmt"],
  subletTotal: ["SubletTotal", "SubletTotalAmt", "TotalSublet"],
} as const;

const JURISDICTION_ALIASES = {
  explicitState: ["LossState", "LossStateProvince", "AccidentState"],
  policyState: ["PolicyState", "PolicyStateProvince"],
} as const;

const LINE_ITEM_FIELD_ALIASES = {
  section: ["Section", "EstimateSection", "Category"],
  partType: ["PartType", "PartCategory"],
  quantity: ["Quantity", "Qty"],
  bodyLaborHours: ["BodyLaborHours"],
  mechanicalLaborHours: ["MechLaborHours", "MechanicalLaborHours"],
  frameLaborHours: ["FrameLaborHours"],
  unitPrice: ["UnitPrice", "UnitAmt"],
  extendedAmount: ["ExtendedAmount", "ExtendedAmt", "Amount", "LineTotal", "TotalAmount"],
  tax: ["Tax", "TaxAmt", "TaxAmount"],
  includedFlag: ["IncludedFlag", "IncludedInd", "Included"],
  manualEntry: ["ManualEntry", "ManualEntryInd", "ManualInd"],
  betterment: ["Betterment", "BettermentAmt", "BettermentPercent"],
} as const;

export function normalizeCccBmsEstimate(
  xml: string,
  options: CccBmsEstimateNormalizerOptions = {}
): NormalizedCccEstimate {
  try {
    const core = normalizeCccBmsEstimateCore(xml);
    const rqUid = options.rqUid ?? core.header.rqUid;
    const parties = buildParties(xml, core.header);
    const jurisdictionEvidence = buildJurisdictionEvidence(xml, parties);
    const parseWarnings = dedupeMessages(core.parseWarnings);

    return {
      sourceSystem: "ccc_secure_share_bms",
      evidenceLane: "estimate_evidence",
      sourceConfidence: "high",
      environment: options.environment,
      rqUid,
      appId: options.appId ?? null,
      sourceEventId: options.sourceEventId ?? null,
      identifiers: {
        documentId: firstText(xml, IDENTIFIER_ALIASES.documentId),
        workfileId: firstText(xml, IDENTIFIER_ALIASES.workfileId),
        estimateId: core.header.estimateId,
        estimateVersion: firstText(xml, IDENTIFIER_ALIASES.estimateVersion),
        supplementNumber: core.header.supplementNumber,
        claimNumber: core.header.claimNumber,
        claimNumberRedacted: redactClaimNumber(core.header.claimNumber),
        claimNumberHash: sha256OrNull(core.header.claimNumber),
      },
      vehicle: buildVehicle(xml, core.vehicle),
      parties,
      totals: buildTotals(xml, core.header.totalAmount),
      jurisdictionEvidence,
      jurisdictionResolution: buildJurisdictionResolution(jurisdictionEvidence),
      lineItems: core.lineItems.map((line) => normalizeLineItem(line, xml)),
      parseWarnings,
      limitations: buildLimitations({
        xml,
        hasClaimNumber: Boolean(core.header.claimNumber),
        hasEstimateIdentifier: Boolean(core.header.estimateId || core.header.estimateNumber),
        hasVehicle: Boolean(core.vehicle),
        hasLineItems: core.lineItems.length > 0,
        jurisdictionEvidence,
      }),
    };
  } catch (error) {
    const parseWarnings = [
      error instanceof Error
        ? `CCC BMS XML could not be normalized: ${error.message}`
        : "CCC BMS XML could not be normalized.",
    ];

    return buildEmptyNormalizedEstimate(options, parseWarnings);
  }
}

function buildVehicle(
  xml: string,
  vehicle: ReturnType<typeof normalizeCccBmsEstimateCore>["vehicle"]
): NormalizedCccEstimate["vehicle"] {
  const structuredVehicle = normalizeCccStructuredVehicle(vehicle);
  const vin = structuredVehicle.vin ?? vehicle?.vin ?? null;
  const decodedVehicle = vin ? decodeVinVehicleIdentity(vin) : undefined;
  const decodeLimitations = buildVinDecodeLimitations(structuredVehicle, decodedVehicle, vin);

  return {
    vin,
    vinRedacted: redactVin(vin),
    vinTail: deriveVinTail(vin),
    year: structuredVehicle.year ?? decodedVehicle?.year ?? null,
    make: structuredVehicle.make ?? decodedVehicle?.make ?? null,
    model: structuredVehicle.model ?? decodedVehicle?.model ?? null,
    trim: structuredVehicle.trim ?? decodedVehicle?.trim ?? null,
    mileage: parseNumber(firstText(xml, ["Mileage", "Odometer", "OdometerReading"])),
    decoded: {
      attempted: Boolean(vin),
      source: vin ? "existing_vin_decoder" : "not_attempted",
      confidence: decodeVehicleConfidence(decodedVehicle),
      limitations: decodeLimitations,
    },
  };
}

function normalizeCccStructuredVehicle(
  vehicle: ReturnType<typeof normalizeCccBmsEstimateCore>["vehicle"]
): VehicleIdentity {
  const normalized = normalizeVehicleIdentity({
    vin: vehicle?.vin ?? undefined,
    year: vehicle?.year ?? undefined,
    make: vehicle?.make ?? undefined,
    model: vehicle?.model ?? undefined,
    trim: vehicle?.trim ?? undefined,
    confidence: 0.98,
    source: "attachment",
    fieldSources: {
      vin: "attachment",
      year: "attachment",
      make: "attachment",
      model: "attachment",
      trim: "attachment",
    },
  });

  return {
    vin: normalized?.vin ?? vehicle?.vin ?? undefined,
    year: vehicle?.year ?? normalized?.year,
    make: vehicle?.make ?? normalized?.make,
    model: vehicle?.model ?? normalized?.model,
    trim: vehicle?.trim ?? normalized?.trim,
    confidence: 0.98,
    source: "attachment",
    fieldSources: {
      vin: "attachment",
      year: "attachment",
      make: "attachment",
      model: "attachment",
      trim: "attachment",
    },
  };
}

function decodeVehicleConfidence(
  decodedVehicle: VehicleIdentity | undefined
): "low" | "medium" | "high" | "unknown" {
  if (!decodedVehicle) return "unknown";
  const decodedFields = [
    decodedVehicle.vin,
    decodedVehicle.year,
    decodedVehicle.make,
    decodedVehicle.model,
    decodedVehicle.trim,
  ].filter(Boolean).length;
  if (decodedFields >= 4) return "high";
  if (decodedFields >= 2) return "medium";
  return decodedFields >= 1 ? "low" : "unknown";
}

function buildVinDecodeLimitations(
  structuredVehicle: VehicleIdentity,
  decodedVehicle: VehicleIdentity | undefined,
  vin: string | null
) {
  const limitations: string[] = [];

  if (!vin) {
    limitations.push("VIN was not present in the CCC BMS XML; local VIN decode was not attempted.");
  } else if (!decodedVehicle) {
    limitations.push("Local VIN decoder could not decode this VIN without an external lookup.");
  } else {
    for (const field of ["year", "make", "model", "trim"] as const) {
      const structuredValue = structuredVehicle[field];
      const decodedValue = decodedVehicle[field];
      if (
        structuredValue !== undefined &&
        decodedValue !== undefined &&
        `${structuredValue}`.toLowerCase() !== `${decodedValue}`.toLowerCase()
      ) {
        limitations.push(
          `CCC BMS structured ${field} was preserved over local VIN decode value.`
        );
      }
    }

    if (!decodedVehicle.model || !decodedVehicle.trim) {
      limitations.push("Local VIN decode is partial; no external VIN API was called.");
    }
  }

  return dedupeMessages(limitations);
}

function buildParties(
  xml: string,
  header: ReturnType<typeof normalizeCccBmsEstimateCore>["header"]
): NormalizedCccEstimate["parties"] {
  return {
    repairFacility: buildAddressParty(xml, PARTY_ALIASES.repairFacility, header.shopName),
    inspectionSite: buildAddressParty(xml, PARTY_ALIASES.inspectionSite),
    appraiser: buildAddressParty(xml, PARTY_ALIASES.appraiser, header.appraiserName),
    owner: buildAddressParty(xml, PARTY_ALIASES.owner, header.ownerName),
    insured: buildAddressParty(xml, PARTY_ALIASES.insured),
    claimant: buildAddressParty(xml, PARTY_ALIASES.claimant),
    insurer: header.carrierName
      ? {
          name: header.carrierName,
          payerType: firstText(xml, ["PayerType", "InsurerPayerType", "CarrierType"]),
        }
      : null,
  };
}

function buildAddressParty(
  xml: string,
  aliases: (typeof PARTY_ALIASES)[keyof typeof PARTY_ALIASES],
  fallbackName: string | null = null
): AddressParty | null {
  const party: AddressParty = {
    name: firstText(xml, aliases.name) ?? fallbackName,
    address1: firstText(xml, aliases.address1),
    address2: firstText(xml, aliases.address2),
    city: firstText(xml, aliases.city),
    state: normalizeStateCode(firstText(xml, aliases.state)),
    zip: firstText(xml, aliases.zip),
    rawLabel: null,
    hasRealAddressBlock: false,
  };
  party.hasRealAddressBlock = Boolean(party.address1 && (party.city || party.state || party.zip));

  return party.name ||
    party.address1 ||
    party.address2 ||
    party.city ||
    party.state ||
    party.zip
    ? party
    : null;
}

function buildTotals(
  xml: string,
  fallbackGrossTotal: number | null
): NormalizedCccEstimate["totals"] {
  const grossTotal = parseNumber(firstText(xml, TOTAL_ALIASES.grossTotal)) ?? fallbackGrossTotal;

  return {
    grossTotal,
    netTotal: parseNumber(firstText(xml, TOTAL_ALIASES.netTotal)),
    deductible: parseNumber(firstText(xml, TOTAL_ALIASES.deductible)),
    tax: parseNumber(firstText(xml, TOTAL_ALIASES.tax)),
    laborTotal: parseNumber(firstText(xml, TOTAL_ALIASES.laborTotal)),
    partsTotal: parseNumber(firstText(xml, TOTAL_ALIASES.partsTotal)),
    paintMaterialsTotal: parseNumber(firstText(xml, TOTAL_ALIASES.paintMaterialsTotal)),
    subletTotal: parseNumber(firstText(xml, TOTAL_ALIASES.subletTotal)),
  };
}

function buildJurisdictionEvidence(
  xml: string,
  parties: NormalizedCccEstimate["parties"]
): NormalizedCccEstimate["jurisdictionEvidence"] {
  const jurisdictionXml = stripLegalSearchResultBlocks(xml);
  const evidence = {
    explicitState: normalizeStateCode(
      firstText(jurisdictionXml, JURISDICTION_ALIASES.explicitState)
    ),
    policyState: normalizeStateCode(firstText(jurisdictionXml, JURISDICTION_ALIASES.policyState)),
    ownerAddressState: parties.owner?.state ?? null,
    ownerAddressZip: parties.owner?.zip ?? null,
    ownerAddressIsRealBlock: Boolean(parties.owner?.hasRealAddressBlock),
    inspectionSiteState: parties.inspectionSite?.state ?? null,
    inspectionSiteZip: parties.inspectionSite?.zip ?? null,
    repairFacilityState: parties.repairFacility?.state ?? null,
    repairFacilityZip: parties.repairFacility?.zip ?? null,
    limitations: [] as string[],
  };

  if (
    !evidence.explicitState &&
    !evidence.policyState &&
    !evidence.ownerAddressState &&
    !evidence.inspectionSiteState &&
    !evidence.repairFacilityState
  ) {
    evidence.limitations.push("No state evidence was found in recognized CCC BMS fields.");
  }

  if (!evidence.ownerAddressIsRealBlock) {
    evidence.limitations.push("Owner address block was missing or incomplete.");
  }

  return evidence;
}

function buildJurisdictionResolution(
  evidence: NormalizedCccEstimate["jurisdictionEvidence"]
): NormalizedCccEstimate["jurisdictionResolution"] {
  const sharedResolution = resolveJurisdiction({
    analysis: { rawEstimateText: buildJurisdictionResolverEvidenceText(evidence) },
  });
  const fallbackResolution = resolveCccJurisdictionFallback(evidence);
  const resolution = chooseCccJurisdictionResolution(sharedResolution, fallbackResolution);

  return {
    state: resolution.state,
    stateCode: resolution.stateCode,
    source: resolution.source,
    confidence: resolution.confidence,
    basis: resolution.basis,
    limitations: dedupeMessages([...(resolution.limitations ?? []), ...evidence.limitations]),
  };
}

function buildJurisdictionResolverEvidenceText(
  evidence: NormalizedCccEstimate["jurisdictionEvidence"]
) {
  const blocks: string[] = [];

  if (evidence.ownerAddressIsRealBlock) {
    blocks.push(
      [
        "Owner Address",
        evidence.ownerAddressState ? `State: ${evidence.ownerAddressState}` : null,
        evidence.ownerAddressZip ? `ZIP: ${evidence.ownerAddressZip}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  if (evidence.inspectionSiteState || evidence.inspectionSiteZip) {
    blocks.push(
      [
        "Inspection Site",
        evidence.inspectionSiteState ? `State: ${evidence.inspectionSiteState}` : null,
        evidence.inspectionSiteZip ? `ZIP: ${evidence.inspectionSiteZip}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  if (evidence.repairFacilityState || evidence.repairFacilityZip) {
    blocks.push(
      [
        "Repair Facility",
        evidence.repairFacilityState ? `State: ${evidence.repairFacilityState}` : null,
        evidence.repairFacilityZip ? `ZIP: ${evidence.repairFacilityZip}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  return blocks.join("\n\n");
}

function resolveCccJurisdictionFallback(
  evidence: NormalizedCccEstimate["jurisdictionEvidence"]
): NormalizedCccJurisdictionResolution {
  if (evidence.explicitState) {
    return buildCccJurisdictionResult(
      evidence.explicitState,
      "ccc_bms_explicit_state",
      "Explicit state from CCC Secure Share estimate data",
      "medium",
      evidence.limitations
    );
  }

  if (evidence.policyState) {
    return buildCccJurisdictionResult(
      evidence.policyState,
      "ccc_bms_policy_state",
      "Policy state from CCC Secure Share estimate data",
      "medium",
      evidence.limitations
    );
  }

  if (evidence.ownerAddressIsRealBlock && evidence.ownerAddressState) {
    return buildCccJurisdictionResult(
      evidence.ownerAddressState,
      evidence.ownerAddressZip ? "owner_zip" : "owner_address",
      evidence.ownerAddressZip
        ? "Owner ZIP from CCC Secure Share estimate data"
        : "Owner address state from CCC Secure Share estimate data",
      "high",
      evidence.limitations
    );
  }

  const inspectionState = stateFromStructuredZipFallback(
    evidence.inspectionSiteZip,
    evidence.inspectionSiteState
  );
  if (inspectionState) {
    return buildCccJurisdictionResult(
      inspectionState,
      "inspection_site_zip_fallback",
      "Inspection Site ZIP from CCC Secure Share estimate data",
      "medium",
      [
        ...evidence.limitations,
        "Jurisdiction is inferred from inspection-site estimate metadata, not from an owner mailing address or policy governing-law clause.",
      ]
    );
  }

  const shopState = stateFromStructuredZipFallback(
    evidence.repairFacilityZip,
    evidence.repairFacilityState
  );
  if (shopState) {
    return buildCccJurisdictionResult(
      shopState,
      "shop_zip_fallback",
      "Repair Facility ZIP from CCC Secure Share estimate data",
      "medium",
      [
        ...evidence.limitations,
        "Jurisdiction is inferred from repair-facility estimate metadata, not from an owner mailing address or policy governing-law clause.",
      ]
    );
  }

  if (evidence.inspectionSiteState) {
    return buildCccJurisdictionResult(
      evidence.inspectionSiteState,
      "inspection_site_address_fallback",
      "Inspection Site state from CCC Secure Share estimate data",
      "medium",
      evidence.limitations
    );
  }

  if (evidence.repairFacilityState) {
    return buildCccJurisdictionResult(
      evidence.repairFacilityState,
      "shop_address_fallback",
      "Repair Facility state from CCC Secure Share estimate data",
      "medium",
      evidence.limitations
    );
  }

  return buildCccUnknownJurisdiction(evidence.limitations);
}

function chooseCccJurisdictionResolution(
  sharedResolution: ResolvedJurisdiction,
  fallbackResolution: NormalizedCccJurisdictionResolution
): NormalizedCccJurisdictionResolution {
  if (
    sharedResolution.state &&
    sharedResolution.source !== "policy_governing_law" &&
    sharedResolution.source !== "explicit_user"
  ) {
    return {
      state: sharedResolution.state,
      stateCode: sharedResolution.stateCode,
      source: sharedResolution.source,
      confidence: sharedResolution.confidence,
      basis: sharedResolution.basis.replace("uploaded estimate", "CCC Secure Share estimate data"),
      limitations: sharedResolution.limitations,
    };
  }

  return fallbackResolution;
}

function buildCccJurisdictionResult(
  state: string,
  source: string,
  basis: string,
  confidence: "low" | "medium" | "high" | "unknown",
  limitations: string[]
): NormalizedCccJurisdictionResolution {
  return {
    state,
    stateCode: state,
    source,
    confidence,
    basis,
    limitations: dedupeMessages(limitations),
  };
}

function buildCccUnknownJurisdiction(
  limitations: string[]
): NormalizedCccJurisdictionResolution {
  return {
    state: null,
    stateCode: null,
    source: "unknown",
    confidence: "unknown",
    basis: null,
    limitations: dedupeMessages([
      ...limitations,
      "State-specific legal and policy conclusions should remain pending until jurisdiction evidence is supplied.",
    ]),
  };
}

function stateFromStructuredZipFallback(
  zip: string | null | undefined,
  state: string | null | undefined
) {
  if (!zip || !state) return null;
  const zipState = stateFromZip(zip);
  return zipState === state ? state : null;
}

function normalizeLineItem(
  line: CccBmsNormalizedLineItem,
  xml: string
): NormalizedCccEstimateLineItem {
  const sourceBlock = findSourceBlock(xml, line.sourcePath);
  const parseWarnings: string[] = [];

  if (!line.operation) parseWarnings.push("Line item operation was not found.");
  if (!line.description && !line.component) {
    parseWarnings.push("Line item description was not found.");
  }

  return {
    sourceSystem: "ccc_secure_share_bms",
    evidenceLane: "estimate_evidence",
    sourceConfidence: "high",
    lineNumber: line.lineNumber,
    section: firstText(sourceBlock, LINE_ITEM_FIELD_ALIASES.section),
    operation: line.operation,
    description: line.description ?? line.component,
    partNumber: line.partNumber,
    partType: firstText(sourceBlock, LINE_ITEM_FIELD_ALIASES.partType),
    laborType: line.laborType,
    quantity: parseNumber(firstText(sourceBlock, LINE_ITEM_FIELD_ALIASES.quantity)),
    laborHours: line.laborHours,
    bodyLaborHours: parseNumber(firstText(sourceBlock, LINE_ITEM_FIELD_ALIASES.bodyLaborHours)),
    paintLaborHours: line.paintHours,
    mechanicalLaborHours: parseNumber(
      firstText(sourceBlock, LINE_ITEM_FIELD_ALIASES.mechanicalLaborHours)
    ),
    frameLaborHours: parseNumber(firstText(sourceBlock, LINE_ITEM_FIELD_ALIASES.frameLaborHours)),
    refinishHours: line.paintHours,
    unitPrice: parseNumber(firstText(sourceBlock, LINE_ITEM_FIELD_ALIASES.unitPrice)),
    extendedAmount:
      line.totalAmount ??
      parseNumber(firstText(sourceBlock, LINE_ITEM_FIELD_ALIASES.extendedAmount)) ??
      line.laborAmount ??
      line.paintAmount ??
      line.partAmount,
    tax: parseNumber(firstText(sourceBlock, LINE_ITEM_FIELD_ALIASES.tax)),
    includedFlag: parseBoolean(firstText(sourceBlock, LINE_ITEM_FIELD_ALIASES.includedFlag)),
    manualEntry: parseBoolean(firstText(sourceBlock, LINE_ITEM_FIELD_ALIASES.manualEntry)),
    betterment: parseNumber(firstText(sourceBlock, LINE_ITEM_FIELD_ALIASES.betterment)),
    rawCategory: firstText(sourceBlock, LINE_ITEM_FIELD_ALIASES.section),
    sourcePath: line.sourcePath,
    parseWarnings,
  };
}

function buildLimitations(params: {
  xml: string;
  hasClaimNumber: boolean;
  hasEstimateIdentifier: boolean;
  hasVehicle: boolean;
  hasLineItems: boolean;
  jurisdictionEvidence: NormalizedCccEstimate["jurisdictionEvidence"];
}): string[] {
  const limitations = [
    "CCC BMS estimate data is estimate-source evidence only and is not OEM, P-page, DEG, legal, policy, or carrier-violation authority.",
  ];

  if (!params.xml.trim()) limitations.push("No CCC BMS XML body was available to normalize.");
  if (!params.hasEstimateIdentifier) limitations.push("Estimate identifier was not found in the CCC BMS XML.");
  if (!params.hasClaimNumber) limitations.push("Claim number was not found in the CCC BMS XML.");
  if (!params.hasVehicle) limitations.push("Vehicle identity fields were not found in the CCC BMS XML.");
  if (!params.hasLineItems) {
    limitations.push("Line items were not found in recognized CCC/CIECA BMS line item blocks.");
  }
  limitations.push(...params.jurisdictionEvidence.limitations);

  return dedupeMessages(limitations);
}

function buildEmptyNormalizedEstimate(
  options: CccBmsEstimateNormalizerOptions,
  parseWarnings: string[]
): NormalizedCccEstimate {
  const jurisdictionEvidence = {
    explicitState: null,
    policyState: null,
    ownerAddressState: null,
    ownerAddressZip: null,
    ownerAddressIsRealBlock: false,
    inspectionSiteState: null,
    inspectionSiteZip: null,
    repairFacilityState: null,
    repairFacilityZip: null,
    limitations: ["No state evidence was found in recognized CCC BMS fields."],
  };

  return {
    sourceSystem: "ccc_secure_share_bms",
    evidenceLane: "estimate_evidence",
    sourceConfidence: "high",
    environment: options.environment,
    rqUid: options.rqUid ?? null,
    appId: options.appId ?? null,
    sourceEventId: options.sourceEventId ?? null,
    identifiers: {
      documentId: null,
      workfileId: null,
      estimateId: null,
      estimateVersion: null,
      supplementNumber: null,
      claimNumber: null,
      claimNumberRedacted: null,
      claimNumberHash: null,
    },
    vehicle: {
      vin: null,
      vinRedacted: null,
      vinTail: null,
      year: null,
      make: null,
      model: null,
      trim: null,
      mileage: null,
      decoded: {
        attempted: false,
        source: "not_attempted",
        confidence: "unknown",
        limitations: ["Vehicle identity fields were not found in the CCC BMS XML."],
      },
    },
    parties: {
      repairFacility: null,
      inspectionSite: null,
      appraiser: null,
      owner: null,
      insured: null,
      claimant: null,
      insurer: null,
    },
    totals: {
      grossTotal: null,
      netTotal: null,
      deductible: null,
      tax: null,
      laborTotal: null,
      partsTotal: null,
      paintMaterialsTotal: null,
      subletTotal: null,
    },
    jurisdictionEvidence,
    jurisdictionResolution: buildJurisdictionResolution(jurisdictionEvidence),
    lineItems: [],
    parseWarnings: dedupeMessages(parseWarnings),
    limitations: buildLimitations({
      xml: "",
      hasClaimNumber: false,
      hasEstimateIdentifier: false,
      hasVehicle: false,
      hasLineItems: false,
      jurisdictionEvidence,
    }),
  };
}

function firstText(xml: string, localNames: readonly string[]): string | null {
  for (const localName of localNames) {
    const pattern = new RegExp(
      `<(?:[\\w.-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${localName}>`,
      "i"
    );
    const value = decodeXmlEntities(stripXmlTags(pattern.exec(xml)?.[1] ?? "")).trim();
    if (value) return value;
  }

  return null;
}

function stripLegalSearchResultBlocks(xml: string) {
  return [
    "LegalSearchResult",
    "LegalSearchResults",
    "LegalResult",
    "LegalResults",
    "RegulatorySearchResult",
    "RegulatorySearchResults",
  ].reduce((nextXml, localName) => {
    const pattern = new RegExp(
      `<(?:[\\w.-]+:)?${localName}\\b[^>]*>[\\s\\S]*?<\\/(?:[\\w.-]+:)?${localName}>`,
      "gi"
    );
    return nextXml.replace(pattern, "");
  }, xml);
}

function findSourceBlock(xml: string, sourcePath: string | null) {
  const tag = sourcePath?.match(/\/([\w.-]+)\[\d+\]$/)?.[1];
  if (!tag) return "";

  const pattern = new RegExp(
    `<(?:[\\w.-]+:)?${escapeRegExp(tag)}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${escapeRegExp(tag)}>`,
    "i"
  );
  return pattern.exec(xml)?.[1] ?? "";
}

function redactVin(vin: string | null | undefined) {
  if (!vin) return null;
  return `${"*".repeat(Math.max(vin.length - 6, 0))}${vin.slice(-6)}`;
}

function deriveVinTail(vin: string | null | undefined) {
  if (!vin) return null;
  return vin.length >= 6 ? vin.slice(-6) : vin;
}

function redactClaimNumber(value: string | null | undefined) {
  if (!value) return null;
  return value.length <= 4 ? "****" : `${"*".repeat(value.length - 4)}${value.slice(-4)}`;
}

function sha256OrNull(value: string | null | undefined) {
  if (!value) return null;
  return createHash("sha256").update(value).digest("hex");
}

function parseNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean(value: string | null): boolean | null {
  if (!value) return null;
  if (/^(?:true|yes|y|1)$/i.test(value.trim())) return true;
  if (/^(?:false|no|n|0)$/i.test(value.trim())) return false;
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

function dedupeMessages(messages: string[]) {
  return [...new Set(messages.filter(Boolean))];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
