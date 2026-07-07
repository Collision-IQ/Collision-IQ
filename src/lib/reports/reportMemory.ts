// Report Memory — recall of saved analysis reports from report history.
// Pure mapping from a stored report (AnalysisReport JSON) to the detail shape
// the Reports tab renders. No report-generation, citation, CCC, Scan IQ, or
// MOTOR logic is touched; this only reads what was already saved.

import type { StoredAnalysisReport } from "@/lib/analysisReportStore";
import type { RepairIntelligenceReport } from "@/lib/ai/types/analysis";

export type ReportMemoryPresentation = "customer" | "pro";

export type ReportMemoryAttachmentRef = {
  attachmentId: string;
  filename: string | null;
  type: string | null;
  available: boolean;
};

export type ReportMemoryMetadata = {
  reportId: string;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string | null;
  title: string;
  vehicleLabel: string | null;
  fileCount: number;
  riskLevel: "low" | "moderate" | "high" | null;
  confidence: "low" | "moderate" | "high" | null;
  reportType: "repair_intelligence" | "scan_iq" | "ccc_secure_share_import";
  sourceSystem: string;
  attachmentCount: number;
  canOpen: boolean;
  canExport: boolean;
};

export type ReportMemoryDetail = {
  metadata: ReportMemoryMetadata;
  /** Customer-first ordering: summary → supporting statements → technical. */
  summary: {
    headline: string;
    riskScore: "low" | "moderate" | "high" | null;
    confidence: "low" | "moderate" | "high" | null;
    criticalIssues: number;
    evidenceQuality: string | null;
  };
  supportingStatements: string[];
  attachments: {
    refs: ReportMemoryAttachmentRef[];
    unavailableNote: string | null;
  };
  /** Present only for Pro/Admin presentation. */
  technical: {
    sourceSystem: string;
    reportType: string;
    missingProcedures: string[];
    supplementOpportunities: string[];
    findingCount: number;
    savedReportExcerpt: string | null;
    importMetadata: Record<string, unknown> | null;
  } | null;
};

export const REPORT_MEMORY_OPEN_ERROR =
  "This report could not be opened. The saved record may be incomplete or unavailable.";

type StoredReportRecord = RepairIntelligenceReport & {
  cccSecureShareImport?: { sourceSystem?: string } & Record<string, unknown>;
  ingestionMeta?: RepairIntelligenceReport["ingestionMeta"] & { reportKind?: string };
};

export function resolveReportKind(
  report: RepairIntelligenceReport
): ReportMemoryMetadata["reportType"] {
  const kind = (report as StoredReportRecord).ingestionMeta?.reportKind;
  if (kind === "scan_iq") return "scan_iq";
  if (kind === "ccc_secure_share_import") return "ccc_secure_share_import";
  return "repair_intelligence";
}

export function resolveSourceSystem(report: RepairIntelligenceReport): string {
  const record = report as StoredReportRecord;
  if (record.cccSecureShareImport?.sourceSystem) return record.cccSecureShareImport.sourceSystem;
  const kind = resolveReportKind(report);
  if (kind === "scan_iq") return "Scan IQ";
  return "Collision IQ";
}

function band(value: unknown): "low" | "moderate" | "high" | null {
  return value === "low" || value === "moderate" || value === "high" ? value : null;
}

function buildHeadline(report: RepairIntelligenceReport, reportType: string): string {
  const risk = band(report.summary?.riskScore);
  const critical = Number(report.summary?.criticalIssues ?? 0);
  if (reportType === "scan_iq") {
    return critical > 0
      ? `Summary: This scan comparison found ${critical} unresolved diagnostic code${critical === 1 ? "" : "s"} after repairs.`
      : "Summary: This scan comparison found no unresolved diagnostic codes after repairs.";
  }
  if (reportType === "ccc_secure_share_import") {
    return "Summary: This estimate was imported from CCC Secure Share (CCC ONE) and is ready for review.";
  }
  if (critical > 0) {
    return `Summary: This analysis flagged ${critical} critical issue${critical === 1 ? "" : "s"}${risk ? ` (${risk} risk)` : ""}.`;
  }
  return risk
    ? `Summary: This analysis completed with ${risk} risk and no critical issues flagged.`
    : "Summary: This saved analysis is available for review.";
}

function buildSupportingStatements(report: RepairIntelligenceReport): string[] {
  const statements: string[] = [];
  for (const finding of report.findingReasoning ?? []) {
    if (finding?.issue) statements.push(String(finding.issue));
  }
  for (const action of report.recommendedActions ?? []) {
    if (action) statements.push(String(action));
  }
  return [...new Set(statements)].slice(0, 12);
}

export function buildReportMemoryDetail(params: {
  stored: StoredAnalysisReport;
  ownerUserId: string;
  updatedAt?: string | null;
  availableAttachments: Array<{ id: string; filename?: string | null; type?: string | null }>;
  presentation: ReportMemoryPresentation;
  canExport: boolean;
}): ReportMemoryDetail {
  const report = params.stored.report ?? ({} as RepairIntelligenceReport);
  const reportType = resolveReportKind(report);
  const sourceSystem = resolveSourceSystem(report);
  const vehicle = report.vehicle;
  const vehicleLabel =
    [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(" ").trim() || null;

  const availableById = new Map(
    params.availableAttachments.map((attachment) => [attachment.id, attachment])
  );
  const refs: ReportMemoryAttachmentRef[] = (params.stored.artifactIds ?? []).map((attachmentId) => {
    const found = availableById.get(attachmentId);
    return {
      attachmentId,
      filename: found?.filename ?? null,
      type: found?.type ?? null,
      available: Boolean(found),
    };
  });
  const unavailableCount = refs.filter((ref) => !ref.available).length;

  const metadata: ReportMemoryMetadata = {
    reportId: params.stored.id,
    ownerUserId: params.ownerUserId,
    createdAt: params.stored.createdAt,
    updatedAt: params.updatedAt ?? null,
    title:
      vehicleLabel ||
      (reportType === "scan_iq"
        ? "Scan IQ comparison"
        : reportType === "ccc_secure_share_import"
          ? "CCC Secure Share import"
          : "Repair analysis"),
    vehicleLabel,
    fileCount: refs.length,
    riskLevel: band(report.summary?.riskScore),
    confidence: band(report.summary?.confidence),
    reportType,
    sourceSystem,
    attachmentCount: refs.length,
    canOpen: true,
    canExport: params.canExport,
  };

  return {
    metadata,
    summary: {
      headline: buildHeadline(report, reportType),
      riskScore: metadata.riskLevel,
      confidence: metadata.confidence,
      criticalIssues: Number(report.summary?.criticalIssues ?? 0),
      evidenceQuality: report.summary?.evidenceQuality ?? null,
    },
    supportingStatements: buildSupportingStatements(report),
    attachments: {
      refs,
      unavailableNote:
        refs.length > 0 && unavailableCount > 0
          ? `${unavailableCount} of ${refs.length} original source file${refs.length === 1 ? "" : "s"} ${unavailableCount === 1 ? "is" : "are"} no longer available. The saved report remains readable.`
          : null,
    },
    technical:
      params.presentation === "pro"
        ? {
            sourceSystem,
            reportType,
            missingProcedures: (report.missingProcedures ?? []).slice(0, 20),
            supplementOpportunities: (report.supplementOpportunities ?? []).slice(0, 20),
            findingCount: (report.findingReasoning ?? []).length,
            savedReportExcerpt: report.sourceEstimateText
              ? report.sourceEstimateText.slice(0, 4000)
              : null,
            importMetadata:
              reportType === "ccc_secure_share_import"
                ? ((report as StoredReportRecord).cccSecureShareImport ?? null)
                : null,
          }
        : null,
  };
}
