// CCC Secure Share Import (Pro-only) — converts already-received, already-
// sanitized CCC Secure Share webhook events (CCC ONE BMS estimates) into
// Collision IQ's review format and a report-history entry.
//
// Guardrails: reads ONLY the stored sanitized normalization (VIN hashed/tail,
// claim number redacted) — no CCC scraping, no write-back to CCC ONE, no
// credentials, no full-payload logging. Photos are imported only when the
// approved CCC data category provides them; their absence never fails import.

import type {
  CccSecureShareEventDetail,
  CccSecureShareLineItemPreview,
} from "@/lib/ccc/secureSharePreview";
import type { RepairIntelligenceReport } from "@/lib/ai/types/analysis";

export const CCC_PHOTOS_UNAVAILABLE_MESSAGE =
  "Photos not provided by CCC Secure Share payload or not available under current app category.";

export function isCccSecureSharePipelineEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CCC_SECURE_SHARE_PIPELINE_ENABLED === "true";
}

export type CccSecureShareImport = {
  sourceSystem: "CCC Secure Share";
  sourceApplication: "CCC ONE";
  externalWorkfileId: string | null;
  externalEstimateId: string | null;
  estimateVersion: string | null;
  supplementNumber: string | null;
  receivedAt: string;
  vehicle: {
    vin: string | null;
    vinTail: string | null;
    year: number | null;
    make: string | null;
    model: string | null;
    trim: string | null;
    mileage: number | null;
  };
  claim: {
    claimNumber: string | null;
    claimNumberRedacted: string | null;
    insurer: string | null;
    policyholder: string | null;
  };
  shop: {
    name: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
  };
  estimate: {
    rawText: string;
    lines: CccSecureShareLineItemPreview[];
    lineCount: number;
    totals: unknown;
  };
  attachments: {
    photosAvailable: boolean;
    photoCount: number;
    importedPhotoIds: string[];
    unavailableReason: string | null;
  };
  jurisdiction: {
    stateCode: string | null;
    source: string | null;
    confidence: string | null;
  };
  warnings: string[];
};

type HeaderRecord = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function record(value: unknown): HeaderRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as HeaderRecord) : {};
}

/** Normalize a stored CCC Secure Share event into the import object. */
export function buildCccSecureShareImport(detail: CccSecureShareEventDetail): CccSecureShareImport {
  const header = record(detail.normalizedHeader);
  const identifiers = record(header.identifiers);
  const headerVehicle = record(header.vehicle);
  const parties = record(header.parties);
  const insurer = record(parties.insurer);
  const repairFacility = record(parties.repairFacility);
  const owner = record(parties.owner);

  const lines = detail.lineItemPreview ?? [];
  const warnings = [...(detail.parseWarnings ?? []), ...(detail.normalizationWarnings ?? [])];

  const imported: CccSecureShareImport = {
    sourceSystem: "CCC Secure Share",
    sourceApplication: "CCC ONE",
    externalWorkfileId: str(identifiers.workfileId),
    externalEstimateId: str(identifiers.estimateId) ?? str(identifiers.documentId),
    estimateVersion: str(identifiers.estimateVersion),
    supplementNumber: str(identifiers.supplementNumber),
    receivedAt: detail.receivedAt,
    vehicle: {
      // Stored normalization is sanitized: full VIN is hashed, tail retained.
      vin: null,
      vinTail: detail.vehicle.vinTail ?? str(headerVehicle.vinTail),
      year: detail.vehicle.year ?? num(headerVehicle.year),
      make: detail.vehicle.make ?? str(headerVehicle.make),
      model: detail.vehicle.model ?? str(headerVehicle.model),
      trim: str(headerVehicle.trim),
      mileage: num(headerVehicle.mileage),
    },
    claim: {
      claimNumber: null,
      claimNumberRedacted: str(identifiers.claimNumberRedacted),
      insurer: str(insurer.name),
      policyholder: str(owner.name) ?? str(record(parties.insured).name),
    },
    shop: {
      name: str(repairFacility.name),
      address: [str(repairFacility.address1), str(repairFacility.city), str(repairFacility.state), str(repairFacility.zip)]
        .filter(Boolean)
        .join(", ") || null,
      phone: str(repairFacility.phone),
      email: str(repairFacility.email),
    },
    estimate: {
      rawText: "",
      lines,
      lineCount: detail.normalizedLineItemCount ?? lines.length,
      totals: detail.totals ?? record(header.totals),
    },
    attachments: {
      // BMS estimate payloads under the current approved app category do not
      // carry photos; when CCC provides them this flips without failing older
      // imports.
      photosAvailable: false,
      photoCount: 0,
      importedPhotoIds: [],
      unavailableReason: CCC_PHOTOS_UNAVAILABLE_MESSAGE,
    },
    jurisdiction: {
      stateCode: detail.jurisdiction.stateCode,
      source: detail.jurisdiction.source,
      confidence: detail.jurisdiction.confidence,
    },
    warnings,
  };

  imported.estimate.rawText = buildCccImportReviewText(imported, detail);
  return imported;
}

function formatLine(line: CccSecureShareLineItemPreview): string {
  return [
    line.lineNumber ? `#${line.lineNumber}` : null,
    line.operation,
    line.description,
    line.partType,
    line.laborType,
    line.laborHours != null ? `${line.laborHours}h` : null,
    line.refinishHours != null ? `${line.refinishHours}h refinish` : null,
    line.unitPrice != null ? `$${line.unitPrice}` : null,
    line.extendedAmount != null ? `= $${line.extendedAmount}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
}

/** Estimate-style review text so existing report/chat pipelines can review it. */
export function buildCccImportReviewText(
  imported: CccSecureShareImport,
  detail: CccSecureShareEventDetail
): string {
  const vehicleLabel = [imported.vehicle.year, imported.vehicle.make, imported.vehicle.model, imported.vehicle.trim]
    .filter(Boolean)
    .join(" ");
  return [
    "CCC SECURE SHARE IMPORT (CCC ONE)",
    `Received: ${imported.receivedAt}`,
    `Workfile: ${imported.externalWorkfileId ?? "n/a"} | Estimate: ${imported.externalEstimateId ?? "n/a"} | Version: ${imported.estimateVersion ?? "n/a"} | Supplement: ${imported.supplementNumber ?? "n/a"}`,
    `Vehicle: ${vehicleLabel || "Unknown"}${imported.vehicle.vinTail ? ` (VIN …${imported.vehicle.vinTail})` : ""}${imported.vehicle.mileage ? ` — ${imported.vehicle.mileage} mi` : ""}`,
    `Insurer: ${imported.claim.insurer ?? "Unknown"} | Claim: ${imported.claim.claimNumberRedacted ?? "n/a"}`,
    `Repair facility: ${imported.shop.name ?? "Unknown"}${imported.shop.address ? ` — ${imported.shop.address}` : ""}`,
    `Jurisdiction: ${imported.jurisdiction.stateCode ?? "unresolved"} (${imported.jurisdiction.confidence ?? "unknown"})`,
    `Photos: ${imported.attachments.photosAvailable ? `${imported.attachments.photoCount} imported` : imported.attachments.unavailableReason}`,
    "",
    `ESTIMATE LINES (${imported.estimate.lineCount} total${imported.estimate.lines.length < imported.estimate.lineCount ? `, first ${imported.estimate.lines.length} shown` : ""}):`,
    ...imported.estimate.lines.map(formatLine),
    "",
    `TOTALS: ${JSON.stringify(imported.estimate.totals ?? {})}`,
    detail.aiSafeContextPreview ? "" : "",
  ]
    .filter((line, index, arr) => !(line === "" && arr[index - 1] === ""))
    .join("\n");
}

/** Report-history entry (Pro/Admin history; technical metadata included). */
export function buildCccImportHistoryReport(imported: CccSecureShareImport): RepairIntelligenceReport {
  const base: RepairIntelligenceReport = {
    summary: {
      riskScore: "low",
      confidence: "moderate",
      criticalIssues: 0,
      evidenceQuality: imported.estimate.lineCount > 0 ? "strong" : "weak",
    },
    vehicle: {
      year: imported.vehicle.year ?? undefined,
      make: imported.vehicle.make ?? undefined,
      model: imported.vehicle.model ?? undefined,
    } as RepairIntelligenceReport["vehicle"],
    issues: [],
    requiredProcedures: [],
    presentProcedures: [],
    missingProcedures: [],
    supplementOpportunities: [],
    evidence: [],
    recommendedActions: [
      "Run a Collision IQ estimate review on this imported CCC ONE estimate.",
      imported.attachments.photosAvailable
        ? "Review the imported photos alongside the estimate."
        : imported.attachments.unavailableReason ?? "",
    ].filter(Boolean),
    sourceEstimateText: imported.estimate.rawText,
    ingestionMeta: {
      active: true,
      reportKind: "ccc_secure_share_import",
    } as RepairIntelligenceReport["ingestionMeta"],
  };

  // Persist the full import metadata in the stored report JSON (Pro/Admin
  // technical view); customer-facing rendering stays layman-first upstream.
  return { ...base, cccSecureShareImport: imported } as RepairIntelligenceReport;
}
