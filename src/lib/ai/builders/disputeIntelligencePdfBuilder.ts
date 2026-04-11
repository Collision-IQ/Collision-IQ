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
  const confidence =
    params.report?.summary.confidence ?? params.analysis?.summary?.confidence ?? exportModel.vehicle.confidence;

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
      { label: "Confidence", value: capitalize(confidence) },
      ...(evidenceQuality ? [{ label: "Evidence Quality", value: capitalize(evidenceQuality) }] : []),
    ],
    sections: [
      {
        title: "At-a-Glance Conclusion",
        body: report.summary,
      },
      ...(report.topDrivers.length > 0
        ? [{
            title: "Top Dispute Drivers",
            bullets: report.topDrivers.map(
              (driver) =>
                `${driver.title} | Impact: ${capitalize(driver.impact)} | Status: ${capitalize(driver.supportStatus)} | Why it matters: ${driver.whyItMatters} | Current gap: ${driver.currentGap} | Next action: ${driver.nextAction}`
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
