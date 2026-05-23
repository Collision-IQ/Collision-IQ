import { createHash, randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { buildExportModel, resolveCanonicalInsurer, type ExportModel } from "@/lib/ai/builders/buildExportModel";
import type { DecisionPanel } from "@/lib/ai/builders/buildDecisionPanel";
import type { RepairIntelligenceReport } from "@/lib/ai/types/analysis";
import { cleanOperationDisplayText } from "@/lib/ui/presentationText";

export type CarrierTrendEventInput = {
  reportId: string;
  report: RepairIntelligenceReport;
  panel?: DecisionPanel | null;
};

export type CarrierTrendAnalytics = {
  generatedAt: string;
  windowDays: number;
  carrierCount: number;
  totalEvents: number;
  carriers: CarrierTrendCarrierSummary[];
};

export type CarrierTrendCarrierSummary = {
  carrierKey: string;
  carrierName: string;
  analysisCount: number;
  deniedOperationCount: number;
  calibrationDisputeCount: number;
  laborSuppressionCount: number;
  recurringOmissionCount: number;
  supplementOpportunityCount: number;
  supplementApprovedCount: number;
  supplementApprovalRate: number | null;
  topDeniedOperations: CarrierTrendOperationSummary[];
  topCalibrationDisputes: CarrierTrendOperationSummary[];
  topLaborSuppressionPatterns: CarrierTrendOperationSummary[];
  topEstimateOmissions: CarrierTrendOperationSummary[];
};

export type CarrierTrendOperationSummary = {
  operation: string;
  count: number;
};

type TrendEvent = {
  carrierKey: string;
  carrierName: string;
  sourceReportHash: string;
  deniedOperationCount: number;
  calibrationDisputeCount: number;
  laborSuppressionCount: number;
  recurringOmissionCount: number;
  supplementOpportunityCount: number;
  supplementApprovedCount: number;
  deniedOperations: string[];
  calibrationOperations: string[];
  laborSuppressionOperations: string[];
  omittedOperations: string[];
  metadata: {
    anonymized: true;
    extractionVersion: string;
    reportConfidence: string | null;
    evidenceQuality: string | null;
  };
};

type CarrierTrendEventRow = {
  carrier_key: string;
  carrier_name: string;
  denied_operation_count: number;
  calibration_dispute_count: number;
  labor_suppression_count: number;
  recurring_omission_count: number;
  supplement_opportunity_count: number;
  supplement_approved_count: number;
  denied_operations: unknown;
  calibration_operations: unknown;
  labor_suppression_operations: unknown;
  omitted_operations: unknown;
};

const UNKNOWN_CARRIER = "Unknown carrier";

export async function recordCarrierTrendEvent(params: CarrierTrendEventInput): Promise<void> {
  const exportModel = buildExportModel({
    report: params.report,
    analysis: params.report.analysis ?? null,
    panel: params.panel ?? null,
    assistantAnalysis: params.report.analysis?.narrative ?? null,
  });
  const event = buildCarrierTrendEvent(params.reportId, params.report, exportModel);

  if (!event) {
    return;
  }

  await prisma.$executeRawUnsafe(
    `
    INSERT INTO "CarrierTrendEvent" (
      "id",
      "carrier_key",
      "carrier_name",
      "source_report_hash",
      "denied_operation_count",
      "calibration_dispute_count",
      "labor_suppression_count",
      "recurring_omission_count",
      "supplement_opportunity_count",
      "supplement_approved_count",
      "denied_operations",
      "calibration_operations",
      "labor_suppression_operations",
      "omitted_operations",
      "metadata"
    ) VALUES (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7,
      $8,
      $9,
      $10,
      $11::jsonb,
      $12::jsonb,
      $13::jsonb,
      $14::jsonb,
      $15::jsonb
    )
    ON CONFLICT ("source_report_hash") DO UPDATE SET
      "carrier_key" = EXCLUDED."carrier_key",
      "carrier_name" = EXCLUDED."carrier_name",
      "denied_operation_count" = EXCLUDED."denied_operation_count",
      "calibration_dispute_count" = EXCLUDED."calibration_dispute_count",
      "labor_suppression_count" = EXCLUDED."labor_suppression_count",
      "recurring_omission_count" = EXCLUDED."recurring_omission_count",
      "supplement_opportunity_count" = EXCLUDED."supplement_opportunity_count",
      "supplement_approved_count" = EXCLUDED."supplement_approved_count",
      "denied_operations" = EXCLUDED."denied_operations",
      "calibration_operations" = EXCLUDED."calibration_operations",
      "labor_suppression_operations" = EXCLUDED."labor_suppression_operations",
      "omitted_operations" = EXCLUDED."omitted_operations",
      "metadata" = EXCLUDED."metadata"
  `,
    randomUUID(),
    event.carrierKey,
    event.carrierName,
    event.sourceReportHash,
    event.deniedOperationCount,
    event.calibrationDisputeCount,
    event.laborSuppressionCount,
    event.recurringOmissionCount,
    event.supplementOpportunityCount,
    event.supplementApprovedCount,
    JSON.stringify(event.deniedOperations),
    JSON.stringify(event.calibrationOperations),
    JSON.stringify(event.laborSuppressionOperations),
    JSON.stringify(event.omittedOperations),
    JSON.stringify(event.metadata)
  );
}

export async function getCarrierTrendAnalytics(windowDays = 90): Promise<CarrierTrendAnalytics> {
  const safeWindowDays = Math.min(Math.max(Math.trunc(windowDays), 1), 730);
  const since = new Date(Date.now() - safeWindowDays * 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRaw<CarrierTrendEventRow[]>`
    SELECT
      "carrier_key",
      "carrier_name",
      "denied_operation_count",
      "calibration_dispute_count",
      "labor_suppression_count",
      "recurring_omission_count",
      "supplement_opportunity_count",
      "supplement_approved_count",
      "denied_operations",
      "calibration_operations",
      "labor_suppression_operations",
      "omitted_operations"
    FROM "CarrierTrendEvent"
    WHERE "event_date" >= ${since}
  `;

  return aggregateCarrierTrendRows(rows, safeWindowDays);
}

export function buildCarrierTrendEvent(
  reportId: string,
  report: RepairIntelligenceReport,
  exportModel: ExportModel
): TrendEvent | null {
  const carrierName = normalizeCarrierName(resolveCanonicalInsurer(exportModel));
  if (!carrierName || carrierName === UNKNOWN_CARRIER) {
    return null;
  }

  const deniedOperations = new Set<string>();
  const calibrationOperations = new Set<string>();
  const laborSuppressionOperations = new Set<string>();
  const omittedOperations = new Set<string>();

  for (const item of exportModel.supplementItems) {
    const operation = normalizeOperation(item.title);
    const corpus = `${item.title} ${item.category} ${item.kind} ${item.rationale} ${item.evidence ?? ""}`.toLowerCase();

    if (item.kind === "missing_operation" || item.kind === "underwritten_operation" || item.kind === "disputed_repair_path") {
      deniedOperations.add(operation);
    }
    if (item.kind === "missing_operation" || item.kind === "missing_verification") {
      omittedOperations.add(operation);
    }
    if (isCalibrationDispute(corpus)) {
      calibrationOperations.add(operation);
    }
    if (isLaborSuppression(corpus)) {
      laborSuppressionOperations.add(operation);
    }
  }

  for (const contradiction of exportModel.oemContradictions) {
    const operation = normalizeOperation(contradiction.affectedOperation);
    const corpus = `${contradiction.affectedOperation} ${contradiction.conflictSummary} ${contradiction.sourceType}`.toLowerCase();
    deniedOperations.add(operation);
    if (isCalibrationDispute(corpus)) calibrationOperations.add(operation);
    if (isLaborSuppression(corpus)) laborSuppressionOperations.add(operation);
  }

  const supplementApprovedCount = dedupeStrings([
    ...report.presentProcedures,
    ...exportModel.reportFields.presentStrengths,
    ...exportModel.reportFields.documentedProcedures,
  ]).length;
  const supplementOpportunityCount = Math.max(
    exportModel.supplementItems.length,
    report.supplementOpportunities.length,
    deniedOperations.size
  );

  return {
    carrierKey: buildCarrierKey(carrierName),
    carrierName,
    sourceReportHash: hashSourceReportId(reportId),
    deniedOperationCount: deniedOperations.size,
    calibrationDisputeCount: calibrationOperations.size,
    laborSuppressionCount: laborSuppressionOperations.size,
    recurringOmissionCount: omittedOperations.size,
    supplementOpportunityCount,
    supplementApprovedCount,
    deniedOperations: [...deniedOperations],
    calibrationOperations: [...calibrationOperations],
    laborSuppressionOperations: [...laborSuppressionOperations],
    omittedOperations: [...omittedOperations],
    metadata: {
      anonymized: true,
      extractionVersion: "carrier-trends-v1",
      reportConfidence: report.summary.confidence ?? null,
      evidenceQuality: report.summary.evidenceQuality ?? null,
    },
  };
}

function aggregateCarrierTrendRows(
  rows: CarrierTrendEventRow[],
  windowDays: number
): CarrierTrendAnalytics {
  const carriers = new Map<string, CarrierTrendCarrierSummary & {
    deniedCounter: Map<string, number>;
    calibrationCounter: Map<string, number>;
    laborCounter: Map<string, number>;
    omissionCounter: Map<string, number>;
  }>();

  for (const row of rows) {
    const existing = carriers.get(row.carrier_key) ?? {
      carrierKey: row.carrier_key,
      carrierName: row.carrier_name,
      analysisCount: 0,
      deniedOperationCount: 0,
      calibrationDisputeCount: 0,
      laborSuppressionCount: 0,
      recurringOmissionCount: 0,
      supplementOpportunityCount: 0,
      supplementApprovedCount: 0,
      supplementApprovalRate: null,
      topDeniedOperations: [],
      topCalibrationDisputes: [],
      topLaborSuppressionPatterns: [],
      topEstimateOmissions: [],
      deniedCounter: new Map<string, number>(),
      calibrationCounter: new Map<string, number>(),
      laborCounter: new Map<string, number>(),
      omissionCounter: new Map<string, number>(),
    };

    existing.analysisCount += 1;
    existing.deniedOperationCount += row.denied_operation_count;
    existing.calibrationDisputeCount += row.calibration_dispute_count;
    existing.laborSuppressionCount += row.labor_suppression_count;
    existing.recurringOmissionCount += row.recurring_omission_count;
    existing.supplementOpportunityCount += row.supplement_opportunity_count;
    existing.supplementApprovedCount += row.supplement_approved_count;
    incrementOperations(existing.deniedCounter, coerceStringArray(row.denied_operations));
    incrementOperations(existing.calibrationCounter, coerceStringArray(row.calibration_operations));
    incrementOperations(existing.laborCounter, coerceStringArray(row.labor_suppression_operations));
    incrementOperations(existing.omissionCounter, coerceStringArray(row.omitted_operations));
    carriers.set(row.carrier_key, existing);
  }

  const summaries = [...carriers.values()].map((carrier) => {
    const supplementTotal = carrier.supplementApprovedCount + carrier.supplementOpportunityCount;
    return {
      carrierKey: carrier.carrierKey,
      carrierName: carrier.carrierName,
      analysisCount: carrier.analysisCount,
      deniedOperationCount: carrier.deniedOperationCount,
      calibrationDisputeCount: carrier.calibrationDisputeCount,
      laborSuppressionCount: carrier.laborSuppressionCount,
      recurringOmissionCount: carrier.recurringOmissionCount,
      supplementOpportunityCount: carrier.supplementOpportunityCount,
      supplementApprovedCount: carrier.supplementApprovedCount,
      supplementApprovalRate: supplementTotal > 0 ? carrier.supplementApprovedCount / supplementTotal : null,
      topDeniedOperations: topOperations(carrier.deniedCounter),
      topCalibrationDisputes: topOperations(carrier.calibrationCounter),
      topLaborSuppressionPatterns: topOperations(carrier.laborCounter),
      topEstimateOmissions: topOperations(carrier.omissionCounter),
    };
  });

  summaries.sort((a, b) => b.analysisCount - a.analysisCount || b.deniedOperationCount - a.deniedOperationCount);

  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    carrierCount: summaries.length,
    totalEvents: rows.length,
    carriers: summaries,
  };
}

function normalizeCarrierName(value: string | null | undefined): string {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  if (!cleaned) return UNKNOWN_CARRIER;
  return cleaned;
}

function buildCarrierKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "unknown";
}

function hashSourceReportId(reportId: string): string {
  const salt = process.env.CARRIER_TREND_HASH_SALT || process.env.NEXTAUTH_SECRET || "collision-iq-carrier-trends";
  return createHash("sha256").update(`${salt}:${reportId}`).digest("hex");
}

function normalizeOperation(value: string): string {
  return cleanOperationDisplayText(value).replace(/\s+/g, " ").trim() || "Unspecified operation";
}

function isCalibrationDispute(value: string): boolean {
  return /\b(calibration|adas|radar|camera|sensor|aim|scan|dtc|module|pre[- ]?scan|post[- ]?scan)\b/i.test(value);
}

function isLaborSuppression(value: string): boolean {
  return /\b(labor|hours?|refinish|paint|body|mechanical|frame|blend|rate|time|underwritten|suppressed|allowance)\b/i.test(value);
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function coerceStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function incrementOperations(counter: Map<string, number>, operations: string[]): void {
  for (const operation of operations) {
    counter.set(operation, (counter.get(operation) ?? 0) + 1);
  }
}

function topOperations(counter: Map<string, number>): CarrierTrendOperationSummary[] {
  return [...counter.entries()]
    .map(([operation, count]) => ({ operation, count }))
    .sort((a, b) => b.count - a.count || a.operation.localeCompare(b.operation))
    .slice(0, 8);
}
