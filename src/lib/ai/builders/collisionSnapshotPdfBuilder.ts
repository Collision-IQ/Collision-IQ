import {
  buildExportModel,
  redactExportModelForDownload,
  type ExportModel,
} from "./buildExportModel";
import { buildCollisionSnapshot, type CollisionSnapshot } from "./collisionSnapshot";
import type { CarrierReportDocument } from "./carrierPdfBuilder";
import type { ExportBuilderInput } from "./exportTemplates";
import { normalizeWorkspaceEstimateComparisons } from "@/lib/workspace/estimateComparisons";
import { sanitizeCustomerFacingDocument, toCustomerFacingList, toCustomerFacingText } from "@/lib/ai/customerFacingText";
import {
  buildIndexedExclusionAuditNote,
  buildReviewCompletenessMessage,
} from "@/lib/reviewCompleteness";

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
  const cleanSnapshot = sanitizeSnapshotForFinalRender(snapshot);

  return sanitizeCustomerFacingDocument({
    filename: "collision-snapshot.pdf",
    brand: {
      companyName: "Collision Academy",
      reportLabel: "1-Page Snapshot",
      logoPath: "/brand/logos/logo-horizontal.png",
    },
    header: {
      title: cleanSnapshot.title,
      subtitle: `${cleanSnapshot.vehicleLabel} | Sensitive details removed for sharing`,
      generatedLabel: `Generated ${new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })}`,
    },
    summary: [
      { label: "Vehicle", value: cleanSnapshot.vehicleLabel },
      { label: "More Complete Plan", value: cleanSnapshot.repairPlanVerdict.moreCompletePlan },
      { label: "Carrier Plan", value: cleanSnapshot.repairPlanVerdict.carrierPlanStatus },
      { label: "Approach", value: cleanSnapshot.pressureMode.charAt(0).toUpperCase() + cleanSnapshot.pressureMode.slice(1) },
    ],
    sections: [
      {
        title: "Damage Snapshot",
        bullets: cleanSnapshot.damageSummary.slice(0, 3),
      },
      {
        title: "Repair Plan Verdict",
        body: cleanSnapshot.repairPlanVerdict.reason,
      },
      ...(cleanSnapshot.verdictLine
        ? [{ title: "File Assessment", body: cleanSnapshot.verdictLine }]
        : []),
      {
        title: "Estimate Comparison",
        bullets: buildEstimateBullets(cleanSnapshot),
      },
      {
        title: "Top Dispute Items",
        bullets: cleanSnapshot.topDisputeItems.map(
          (item, index) =>
            `${index + 1}. ${item.issue}: ${item.whyItMatters} The current file appears to support this item. Next: ${item.nextAction}`
        ),
      },
      {
        title: "File Coverage",
        bullets: buildCompletenessBullets(cleanSnapshot),
      },
      {
        title: "Next Actions",
        bullets: cleanSnapshot.nextActions.map((item, index) => `${index + 1}. ${item}`),
      },
      {
        title: "Market Preview",
        bullets: buildValuationBullets(cleanSnapshot),
      },
    ],
    footer: [
      cleanSnapshot.disclosure,
      cleanSnapshot.redactionNotice,
    ],
  });
}

export function sanitizeSnapshotForFinalRender(snapshot: CollisionSnapshot): CollisionSnapshot {
  return {
    ...snapshot,
    title: toCustomerFacingText(snapshot.title, "Collision Snapshot"),
    vehicleLabel: toCustomerFacingText(snapshot.vehicleLabel, "Vehicle not specified"),
    damageSummary: toCustomerFacingList(snapshot.damageSummary, [
      "Damage summary is limited to the current uploaded and retrieved file set.",
    ]).slice(0, 3),
    repairPlanVerdict: {
      moreCompletePlan: snapshot.repairPlanVerdict.moreCompletePlan,
      carrierPlanStatus: snapshot.repairPlanVerdict.carrierPlanStatus,
      reason: toCustomerFacingText(snapshot.repairPlanVerdict.reason),
    },
    estimateComparison: {
      ...snapshot.estimateComparison,
      keyDeltas: toCustomerFacingList(snapshot.estimateComparison.keyDeltas, []),
      unavailableReason: snapshot.estimateComparison.unavailableReason
        ? toCustomerFacingText(snapshot.estimateComparison.unavailableReason)
        : undefined,
    },
    topDisputeItems: snapshot.topDisputeItems.map((item) => ({
      ...item,
      issue: toCustomerFacingText(item.issue, "Repair item to review"),
      whyItMatters: toCustomerFacingText(item.whyItMatters, "This item may affect repair quality, safety, or final fit."),
      evidenceState: "The current file appears to support this item.",
      nextAction: toCustomerFacingText(
        item.nextAction,
        "Ask the insurer or repair shop to explain whether this item is included, and if not, why."
      ),
    })),
    evidenceCompleteness: {
      ...snapshot.evidenceCompleteness,
      missingCriticalEvidence: toCustomerFacingList(snapshot.evidenceCompleteness.missingCriticalEvidence, []),
      userFacingDisclosure: toCustomerFacingText(snapshot.evidenceCompleteness.userFacingDisclosure),
    },
    nextActions: toCustomerFacingList(snapshot.nextActions, [
      "Ask what will be checked before the estimate is considered complete.",
    ]),
    verdictLine: snapshot.verdictLine ? toCustomerFacingText(snapshot.verdictLine) : undefined,
    valuationSnapshot: {
      ...snapshot.valuationSnapshot,
      confidence: snapshot.valuationSnapshot.confidence
        ? toCustomerFacingText(snapshot.valuationSnapshot.confidence)
        : undefined,
      disclosure: toCustomerFacingText(snapshot.valuationSnapshot.disclosure),
    },
    disclosure: toCustomerFacingText(snapshot.disclosure),
    redactionNotice: toCustomerFacingText(snapshot.redactionNotice, "Sensitive details removed for sharing."),
    pressureModeRationale: toCustomerFacingText(snapshot.pressureModeRationale),
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
    buildReviewCompletenessMessage({
      reviewed: snapshot.evidenceCompleteness.reviewedFileCount,
      total: snapshot.evidenceCompleteness.reviewableFileCount,
    }),
    buildIndexedExclusionAuditNote({
      indexedCount: snapshot.evidenceCompleteness.indexedFileCount,
      reviewableFileCount: snapshot.evidenceCompleteness.reviewableFileCount,
      excludedFromReviewCount: snapshot.evidenceCompleteness.excludedFromReviewCount,
    }),
    snapshot.evidenceCompleteness.uploadLimitReached ? "The current upload limit was reached." : "More files can be added if needed.",
    snapshot.evidenceCompleteness.userIndicatedMoreFiles
      ? "The owner or shop indicated there may be more files to review."
      : "No additional file note was provided.",
    snapshot.evidenceCompleteness.missingCriticalEvidence.length
      ? `Still worth checking: ${snapshot.evidenceCompleteness.missingCriticalEvidence.slice(0, 4).join(", ")}`
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
      ? `Market preview: ${snapshot.valuationSnapshot.acvPreviewRange}`
      : null,
    snapshot.valuationSnapshot.dvPreviewRange
      ? `DV preview: ${snapshot.valuationSnapshot.dvPreviewRange}`
      : null,
    snapshot.valuationSnapshot.disclosure,
  ].filter((item): item is string => Boolean(item));
}
