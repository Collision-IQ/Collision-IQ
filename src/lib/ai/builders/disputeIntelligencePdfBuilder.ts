import type { CarrierReportDocument } from "./carrierPdfBuilder";
import {
  buildExportModel,
  redactExportModelForDownload,
  resolveCanonicalInsurer,
  resolveCanonicalVehicleLabel,
  resolveCanonicalVin,
} from "./buildExportModel";
import type { ExportBuilderInput } from "./exportTemplates";

export function buildDisputeIntelligencePdf(params: ExportBuilderInput): CarrierReportDocument {
  const exportModel = params.renderModel
    ? redactExportModelForDownload(params.renderModel)
    : redactExportModelForDownload(
        buildExportModel({
          report: params.report,
          analysis: params.analysis,
          panel: params.panel,
          assistantAnalysis: params.assistantAnalysis,
        })
      );
  const report = exportModel.disputeIntelligenceReport;
  const vehicleIdentity = resolveCanonicalVehicleLabel(exportModel) ?? "Unspecified";
  const vin = resolveCanonicalVin(exportModel) ?? "Unspecified";
  const insurer = resolveCanonicalInsurer(exportModel);
  const evidenceQuality =
    params.report?.summary.evidenceQuality ?? params.analysis?.summary?.evidenceQuality ?? undefined;
  const confidence = exportModel.confidenceIntegrity.adjustedConfidence;

  return {
    filename: "collision-iq-dispute-intelligence-report.pdf",
    brand: {
      companyName: "Collision Academy",
      reportLabel: "Dispute Intelligence Report",
      logoPath: "/brand/logos/logo-horizontal.png",
    },
    header: {
      title: "Dispute Intelligence Report",
      subtitle:
        "Decision-ready export focused on the strongest dispute drivers, support gaps, and next documentation moves from the current file.",
      generatedLabel: `Generated ${new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })}`,
    },
    summary: [
      { label: "Vehicle", value: vehicleIdentity },
      { label: "VIN", value: vin },
      ...(insurer ? [{ label: "Insurer", value: insurer }] : []),
      ...(typeof exportModel.reportFields.mileage === "number"
        ? [{ label: "Mileage", value: exportModel.reportFields.mileage.toLocaleString("en-US") }]
        : []),
      ...(typeof exportModel.reportFields.estimateTotal === "number"
        ? [{
            label: "Estimate Total",
            value: `$${exportModel.reportFields.estimateTotal.toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`,
          }]
        : []),
      { label: "Adjusted Confidence", value: confidence },
      ...(evidenceQuality ? [{ label: "Evidence Quality", value: capitalize(evidenceQuality) }] : []),
    ],
    sections: [
      {
        title: "At-a-Glance Conclusion",
        body: report.summary,
      },
      {
        title: "File Coverage / Evidence Completeness",
        bullets: buildConfidenceIntegrityBullets(exportModel.confidenceIntegrity),
      },
      ...(report.topDrivers.length > 0
        ? [{
            title: "Top Dispute Drivers",
            bullets: report.topDrivers.map(
              (driver) => {
                const retrievalNote = driver.retrievalSupport.length > 0
                  ? ` | Sources: ${driver.retrievalSupport.join(", ")}`
                  : "";
                return `#${driver.priorityRank} ${driver.title} | Impact: ${capitalize(driver.impact)} | Leverage: ${driver.leverageScore}/100 | Evidence: ${driver.evidenceLevel} | ${driver.whyThisWins}${retrievalNote} | Status: ${driver.currentGap} | Next: ${driver.nextAction}`;
              }
            ),
          }]
        : []),
      ...(exportModel.findingReasoning.length > 0
        ? [{
            title: "Finding Reasoning",
            bullets: exportModel.findingReasoning.slice(0, 6).map((finding) =>
              `${finding.priorityRank ?? ""}. ${finding.issue} | Why: ${finding.why_it_matters} | Proof: ${finding.what_proves_it} | Next: ${finding.next_action} | Evidence: ${capitalize(finding.evidenceLevel)}`
            ),
          }]
        : []),
      ...(exportModel.retrievalSummary
        ? [{
            title: "Retrieval Summary",
            bullets: buildRetrievalSummaryBullets(exportModel.retrievalSummary),
          }]
        : []),
      ...(exportModel.disputeStrategy
        ? [{
            title: "Dispute Strategy",
            bullets: buildDisputeStrategyBullets(exportModel.disputeStrategy),
          }]
        : []),
      ...(report.top3.length > 0
        ? [{
            title: "3 Strongest Dispute Items",
            bullets: report.top3.map(
              (driver) =>
                `${driver.title}: ${driver.whyItMatters} — ${driver.nextAction}`
            ),
          }]
        : []),
      ...(report.positives.length > 0
        ? [{
            title: "What Helps the Shop Position",
            bullets: report.positives.map((item) => ensureSentence(item)),
          }]
        : []),
      ...(report.supportGaps.length > 0
        ? [{
            title: "What Still Needs Support",
            bullets: report.supportGaps.map((item) => ensureSentence(item)),
          }]
        : []),
      ...(report.nextMoves.length > 0
        ? [{
            title: "Recommended Next Moves",
            bullets: report.nextMoves.map((item) => ensureSentence(item)),
          }]
        : []),
      ...(report.valuationPreview
        ? [{
            title: "Valuation Preview",
            bullets: [
              ensureSentence(report.valuationPreview.dv),
              ensureSentence(report.valuationPreview.acv),
              "Valuation references remain preview-only and are not formal appraisal conclusions.",
            ],
          }]
        : []),
    ],
    footer: [
      "This report is intended to be concise, decision-ready, and documentation-focused.",
      "Use it to prioritize the strongest dispute drivers, close support gaps, and guide next-step conversations.",
    ],
  };
}

function ensureSentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildRetrievalSummaryBullets(
  summary: NonNullable<ReturnType<typeof buildExportModel>["retrievalSummary"]>
): string[] {
  return [
    `Drive docs used: ${summary.driveDocsUsed}.`,
    `Web sources used: ${summary.webSourcesUsed}.`,
    `Serper status: ${capitalize(summary.serperStatus.toLowerCase())}.`,
    `OEM evidence found: ${summary.oemEvidenceFound ? "Yes" : "No"}.`,
    ...summary.sourcesInfluencingFindings.slice(0, 6).map(
      (source) =>
        `${source.title} (${source.sourceType}) influenced ${source.relatedFindingIds.length} finding(s).`
    ),
  ];
}

function buildConfidenceIntegrityBullets(
  integrity: NonNullable<ReturnType<typeof buildExportModel>["confidenceIntegrity"]>
): string[] {
  return [
    `Base confidence: ${integrity.baseConfidence}.`,
    `Adjusted confidence: ${integrity.adjustedConfidence}.`,
    `Completeness: ${capitalize(integrity.completenessStatus.toLowerCase())}.`,
    `Uploaded files reviewed: ${integrity.uploadedFileCount}.`,
    integrity.uploadLimitReached ? "Upload cap reached for this review." : "Upload cap not reached.",
    ...(integrity.userIndicatedMoreFiles ? ["User indicated more files exist outside the current upload set."] : []),
    ...(integrity.missingCriticalEvidence.length > 0
      ? [`Missing proof: ${integrity.missingCriticalEvidence.join("; ")}.`]
      : []),
    ...integrity.confidencePenalties.map((penalty) =>
      `${penalty.reason}: -${penalty.impact}. ${penalty.explanation}`
    ),
    integrity.userFacingDisclosure,
  ];
}

function buildDisputeStrategyBullets(
  strategy: NonNullable<ReturnType<typeof buildExportModel>["disputeStrategy"]>
): string[] {
  return [
    `Leverage score: ${strategy.leverageScore}/100.`,
    ...(strategy.priorityFindings.length > 0
      ? [`Priority rank: ${strategy.priorityFindings.join("; ")}.`]
      : []),
    ...(strategy.easyWins.length > 0
      ? [`Easy wins: ${strategy.easyWins.join("; ")}.`]
      : []),
    ...(strategy.hardFights.length > 0
      ? [`Hard fights: ${strategy.hardFights.join("; ")}.`]
      : []),
    ...strategy.recommendedSequence.slice(0, 5).map((item, index) =>
      `${index + 1}. ${item}`
    ),
  ];
}
