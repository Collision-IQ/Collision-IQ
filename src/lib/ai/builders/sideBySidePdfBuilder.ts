import type { DecisionPanel } from "./buildDecisionPanel";
import type { AnalysisResult, RepairIntelligenceReport } from "../types/analysis";
import type { CarrierReportDocument } from "./carrierPdfBuilder";
import { buildExportTemplateSourceModel, formatAnalysisModeLabel } from "./exportTemplates";
import { buildPreferredVehicleIdentityLabel } from "./buildExportModel";

export function buildSideBySidePdf(params: {
  report: RepairIntelligenceReport | null;
  analysis: AnalysisResult | null;
  panel: DecisionPanel | null;
  assistantAnalysis?: string | null;
}): CarrierReportDocument {
  const source = buildExportTemplateSourceModel(params);
  const { exportModel } = source;
  const isComparison = source.analysisMode === "comparison";
  const vehicleIdentity =
    buildPreferredVehicleIdentityLabel(exportModel.vehicle) ??
    "Vehicle details still limited in the current material.";

  return {
    filename: "collision-iq-side-by-side-report.pdf",
    brand: buildPdfBrand(isComparison ? "Comparison Report" : "Estimate Review"),
    header: buildPdfHeader({
      title: isComparison ? "Side-by-Side Comparison Report" : "Estimate Review Report",
      subtitle:
        isComparison
          ? "Category-level comparison of shop and carrier positions using the shared normalized export model."
          : "Category-level estimate review built from the shared normalized export model.",
      generatedLabel: `Generated ${source.generatedLabel}`,
    }),
    summary: [
      { label: "Vehicle", value: vehicleIdentity },
      { label: "VIN", value: exportModel.vehicle.vin || "Not clearly supported in the current material." },
      ...(exportModel.estimateFacts.insurer
        ? [{ label: "Insurer", value: exportModel.estimateFacts.insurer }]
        : []),
      ...(typeof exportModel.estimateFacts.mileage === "number"
        ? [{ label: "Mileage", value: exportModel.estimateFacts.mileage.toLocaleString("en-US") }]
        : []),
      ...(typeof exportModel.estimateFacts.estimateTotal === "number"
        ? [{
            label: "Estimate Total",
            value: `$${exportModel.estimateFacts.estimateTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          }]
        : []),
      { label: "Mode", value: formatAnalysisModeLabel(source.analysisMode) },
      { label: "Categories", value: `${source.categoryComparisons.length}` },
    ],
    sections: [
      {
        title: "Overall Position",
        bullets: [
          `Summary: ${exportModel.repairPosition}`,
          `${isComparison ? "Carrier-facing posture" : "Support posture"}: ${exportModel.positionStatement}`,
        ],
      },
      ...source.categoryComparisons.map((category) => ({
        title: category.category,
        bullets: [
          `${isComparison ? "Shop position" : "Estimate position"}: ${category.shopPosition}`,
          `${isComparison ? "Carrier position" : "Support posture"}: ${category.carrierPosition}`,
          `Support status: ${formatLabel(category.supportStatus)}`,
          `Rationale: ${category.rationale}`,
        ],
      })),
    ],
    footer: buildPdfFooter(),
  };
}

function buildPdfBrand(reportLabel: string): CarrierReportDocument["brand"] {
  return {
    companyName: "Collision Academy",
    reportLabel,
    logoPath: "/brand/logos/logo-horizontal.png",
  };
}

function buildPdfHeader(params: {
  title: string;
  subtitle: string;
  generatedLabel: string;
}): CarrierReportDocument["header"] {
  return {
    title: params.title,
    subtitle: params.subtitle,
    generatedLabel: params.generatedLabel,
  };
}

function buildPdfFooter(): string[] {
  return [
    "This PDF is generated from the shared normalized repair analysis and export model.",
    "Review and edit the final carrier-facing language as needed before sending or filing.",
  ];
}

function formatLabel(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
