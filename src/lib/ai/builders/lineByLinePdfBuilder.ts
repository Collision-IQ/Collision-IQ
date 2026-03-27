import type { DecisionPanel } from "./buildDecisionPanel";
import type { AnalysisResult, RepairIntelligenceReport } from "../types/analysis";
import type { CarrierReportDocument } from "./carrierPdfBuilder";
import { buildExportTemplateSourceModel } from "./exportTemplates";

export function buildLineByLinePdf(params: {
  report: RepairIntelligenceReport | null;
  analysis: AnalysisResult | null;
  panel: DecisionPanel | null;
  assistantAnalysis?: string | null;
}): CarrierReportDocument {
  const source = buildExportTemplateSourceModel(params);
  const { exportModel } = source;

  return {
    filename: "collision-iq-line-by-line-report.pdf",
    brand: buildPdfBrand("Line-by-Line Report"),
    header: buildPdfHeader({
      title: "Line-by-Line Comparison Report",
      subtitle:
        "Operation-focused report showing estimate lines, rationale, and current support status from the shared normalized export model.",
      generatedLabel: `Generated ${source.generatedLabel}`,
    }),
    summary: [
      { label: "Vehicle", value: exportModel.vehicle.label || "Vehicle details still limited in the current material." },
      { label: "VIN", value: exportModel.vehicle.vin || "Not clearly supported in the current material." },
      { label: "Lines", value: `${source.lineItems.length}` },
      { label: "Focus", value: "Operations, rationale, support status" },
    ],
    sections: source.lineItems.slice(0, 14).map((item, index) => ({
      title: `Line ${index + 1}: ${item.operation}`,
      bullets: [
        `Component: ${item.component}`,
        item.rawLine ? `Estimate line: ${item.rawLine}` : undefined,
        `Carrier position: ${item.carrierPosition}`,
        `Support status: ${formatLabel(item.supportStatus)}`,
        `Rationale: ${item.rationale}`,
        item.support ? `Support: ${item.support}` : undefined,
      ].filter((value): value is string => Boolean(value)),
    })),
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
