import {
  buildExportModel,
  redactExportModelForDownload,
  type ExportModel,
} from "./buildExportModel";
import { buildCollisionSnapshot, type CollisionSnapshot } from "./collisionSnapshot";
import type { CarrierReportDocument } from "./carrierPdfBuilder";
import type { ExportBuilderInput } from "./exportTemplates";
import { normalizeWorkspaceEstimateComparisons } from "@/lib/workspace/estimateComparisons";

export function buildCollisionSnapshotPdf(params: ExportBuilderInput): CarrierReportDocument {
  const exportModel = resolveSnapshotExportModel(params);
  const snapshot = buildCollisionSnapshot({
    renderModel: exportModel,
    estimateComparisons: normalizeWorkspaceEstimateComparisons(
      params.workspaceData?.estimateComparisons ??
        params.analysis?.estimateComparisons ??
        params.report?.analysis?.estimateComparisons
    ),
  });

  return buildCollisionSnapshotPdfFromSnapshot(snapshot);
}

export function buildCollisionSnapshotPdfFromSnapshot(snapshot: CollisionSnapshot): CarrierReportDocument {
  return {
    filename: "collision-snapshot.pdf",
    brand: {
      companyName: "Collision Academy",
      reportLabel: "1-Page Snapshot",
      logoPath: "/brand/logos/logo-horizontal.png",
    },
    header: {
      title: snapshot.title,
      subtitle: `${snapshot.vehicleLabel} | Sensitive details removed for sharing`,
      generatedLabel: `Generated ${new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })}`,
    },
    summary: [
      { label: "Vehicle", value: snapshot.vehicleLabel },
      { label: "More Complete Plan", value: snapshot.repairPlanVerdict.moreCompletePlan },
      { label: "Carrier Plan", value: snapshot.repairPlanVerdict.carrierPlanStatus },
      { label: "Confidence", value: snapshot.evidenceCompleteness.adjustedConfidence },
      { label: "Approach", value: snapshot.pressureMode.charAt(0).toUpperCase() + snapshot.pressureMode.slice(1) },
    ],
    sections: [
      {
        title: "Damage Snapshot",
        bullets: snapshot.damageSummary.slice(0, 3),
      },
      {
        title: "Repair Plan Verdict",
        body: snapshot.repairPlanVerdict.reason,
      },
      ...(snapshot.verdictLine
        ? [{ title: "File Assessment", body: snapshot.verdictLine }]
        : []),
      {
        title: "Estimate Comparison",
        bullets: buildEstimateBullets(snapshot),
      },
      {
        title: "Top Dispute Items",
        bullets: snapshot.topDisputeItems.map(
          (item, index) =>
            `${index + 1}. ${item.issue}: ${item.whyItMatters} Evidence: ${item.evidenceState} Action: ${item.nextAction}`
        ),
      },
      {
        title: "Evidence Completeness",
        bullets: buildCompletenessBullets(snapshot),
      },
      {
        title: "Next Actions",
        bullets: snapshot.nextActions.map((item, index) => `${index + 1}. ${item}`),
      },
      {
        title: "Valuation Snapshot",
        bullets: buildValuationBullets(snapshot),
      },
    ],
    footer: [
      snapshot.disclosure,
      snapshot.redactionNotice,
    ],
  };
}

function resolveSnapshotExportModel(params: ExportBuilderInput): ExportModel {
  if (params.renderModel) {
    return redactExportModelForDownload(params.renderModel);
  }

  return redactExportModelForDownload(
    buildExportModel({
      report: params.report,
      analysis: params.analysis,
      panel: params.panel,
      assistantAnalysis: params.assistantAnalysis,
    })
  );
}

function buildEstimateBullets(snapshot: ReturnType<typeof buildCollisionSnapshot>): string[] {
  if (!snapshot.estimateComparison.available) {
    return [snapshot.estimateComparison.unavailableReason ?? "Estimate comparison is unavailable from the current file."];
  }

  return [
    snapshot.estimateComparison.shopEstimateTotal
      ? `Shop estimate total: ${snapshot.estimateComparison.shopEstimateTotal}`
      : null,
    snapshot.estimateComparison.carrierEstimateTotal
      ? `Carrier estimate total: ${snapshot.estimateComparison.carrierEstimateTotal}`
      : null,
    snapshot.estimateComparison.difference
      ? `Difference: ${snapshot.estimateComparison.difference}`
      : null,
    ...snapshot.estimateComparison.keyDeltas.slice(0, 4),
  ].filter((item): item is string => Boolean(item));
}

function buildCompletenessBullets(snapshot: ReturnType<typeof buildCollisionSnapshot>): string[] {
  return [
    `Adjusted confidence: ${snapshot.evidenceCompleteness.adjustedConfidence}`,
    `Completeness: ${snapshot.evidenceCompleteness.completenessStatus}`,
    `Uploaded files: ${snapshot.evidenceCompleteness.uploadedFileCount}`,
    snapshot.evidenceCompleteness.uploadLimitReached ? "Upload cap reached: yes" : "Upload cap reached: no",
    snapshot.evidenceCompleteness.userIndicatedMoreFiles
      ? "User indicated more files: yes"
      : "User indicated more files: no",
    snapshot.evidenceCompleteness.missingCriticalEvidence.length
      ? `Missing proof: ${snapshot.evidenceCompleteness.missingCriticalEvidence.slice(0, 4).join(", ")}`
      : null,
    snapshot.evidenceCompleteness.userFacingDisclosure,
  ].filter((item): item is string => Boolean(item));
}

function buildValuationBullets(snapshot: ReturnType<typeof buildCollisionSnapshot>): string[] {
  if (!snapshot.valuationSnapshot.available) {
    return [snapshot.valuationSnapshot.disclosure];
  }

  return [
    snapshot.valuationSnapshot.acvPreviewRange
      ? `ACV preview: ${snapshot.valuationSnapshot.acvPreviewRange}`
      : null,
    snapshot.valuationSnapshot.dvPreviewRange
      ? `DV preview: ${snapshot.valuationSnapshot.dvPreviewRange}`
      : null,
    snapshot.valuationSnapshot.confidence ? `Confidence: ${snapshot.valuationSnapshot.confidence}` : null,
    snapshot.valuationSnapshot.disclosure,
  ].filter((item): item is string => Boolean(item));
}
