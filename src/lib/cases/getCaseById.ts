import type { ExportModel } from "@/lib/ai/builders/buildExportModel";
import { buildExportModel } from "@/lib/ai/builders/buildExportModel";
import { normalizeReportToAnalysisResult } from "@/lib/ai/builders/normalizeReportToAnalysisResult";
import type { NormalizedDeterminationResult } from "@/lib/analysis/normalizeDetermination";
import { getNormalizedDetermination } from "@/lib/analysis/getNormalizedDetermination";
import { getAnalysisReport } from "@/lib/analysisReportStore";
import type { LinkedEvidence } from "@/lib/ingest/fetchLinkedEvidence";
import { getUploadedAttachments } from "@/lib/uploadedAttachmentStore";

type GetCaseByIdScope = {
  ownerUserId: string;
  shopId?: string | null;
};

type StoredCaseFile = {
  id: string;
  name: string;
  type: string;
  text: string;
  summary: string | null;
};

export type StoredCaseData = {
  id: string;
  estimateText: string;
  files: StoredCaseFile[];
  linkedEvidence: LinkedEvidence[];
  transcriptSummary: string | null;
  determination: ExportModel["determination"]["answer"] | null;
  determinationPayload: NormalizedDeterminationResult;
  supportGaps: string[];
  extractedFacts: Record<string, string | number | null>;
  vehicle: {
    year: number | null;
    make: string | null;
    model: string | null;
    trim: string | null;
    vin: string | null;
  };
  exportModel: ExportModel;
};

function buildExtractedFacts(exportModel: ExportModel) {
  return {
    vehicleLabel: exportModel.vehicle.label || exportModel.reportFields.vehicleLabel || null,
    vin: exportModel.reportFields.vin || null,
    mileage: exportModel.reportFields.mileage ?? null,
    estimateTotal: exportModel.reportFields.estimateTotal ?? null,
    insurer: exportModel.reportFields.insurer || null,
    repairPosition: exportModel.repairPosition || null,
    valuationSourceType: exportModel.valuation.acvSourceType || null,
  };
}

export async function getCaseById(
  caseId: string,
  scope: GetCaseByIdScope
): Promise<StoredCaseData | null> {
  const storedReport = await getAnalysisReport(caseId, scope);

  if (!storedReport) {
    return null;
  }

  const files = await getUploadedAttachments(storedReport.artifactIds, scope);
  const normalizedAnalysis = normalizeReportToAnalysisResult(storedReport.report);
  const exportModel = buildExportModel({
    report: storedReport.report,
    analysis: normalizedAnalysis,
    panel: null,
    assistantAnalysis:
      storedReport.report.analysis?.narrative ||
      normalizedAnalysis.narrative ||
      "",
  });
  const estimateText =
    storedReport.report.sourceEstimateText ||
    storedReport.report.analysis?.rawEstimateText ||
    normalizedAnalysis.rawEstimateText ||
    "";
  const caseFiles = files.map((file) => ({
    id: file.id,
    name: file.filename,
    type: file.type,
    text: file.text,
    summary: null,
  }));
  const extractedFacts = buildExtractedFacts(exportModel);
  const vehicle = {
    year: exportModel.vehicle.year ?? null,
    make: exportModel.vehicle.make || null,
    model: exportModel.vehicle.model || null,
    trim: exportModel.vehicle.trim || null,
    vin: exportModel.reportFields.vin || null,
  };
  const determinationPayload = getNormalizedDetermination({
    vehicle: {
      ...vehicle,
      mileage: typeof exportModel.reportFields.mileage === "number"
        ? exportModel.reportFields.mileage
        : undefined,
    },
    estimateText,
    files: caseFiles,
    linkedEvidence: storedReport.linkedEvidence ?? [],
    extractedFacts,
  });

  return {
    id: storedReport.id,
    estimateText,
    files: caseFiles,
    linkedEvidence: storedReport.linkedEvidence ?? [],
    transcriptSummary:
      storedReport.report.analysis?.narrative ||
      normalizedAnalysis.narrative ||
      null,
    determination: exportModel.determination?.answer || null,
    determinationPayload,
    supportGaps:
      exportModel.disputeIntelligenceReport.supportGaps.length > 0
        ? exportModel.disputeIntelligenceReport.supportGaps
        : exportModel.determination?.missingFactors ?? [],
    extractedFacts,
    vehicle,
    exportModel,
  };
}
