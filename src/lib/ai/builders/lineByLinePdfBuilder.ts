import type { CarrierReportDocument } from "./carrierPdfBuilder";
import { buildExportTemplateSourceModel, type ExportBuilderInput } from "./exportTemplates";
import {
  resolveCanonicalInsurer,
  resolveCanonicalVehicleLabel,
  resolveCanonicalVin,
} from "./buildExportModel";

export function buildLineByLinePdf(params: ExportBuilderInput): CarrierReportDocument {
  const source = buildExportTemplateSourceModel(params);
  const { exportModel } = source;
  const isComparison = source.analysisMode === "comparison";
  const vehicleIdentity = resolveCanonicalVehicleLabel(exportModel) ?? "Unspecified";
  const vin = resolveCanonicalVin(exportModel) ?? "Unspecified";
  const insurer = resolveCanonicalInsurer(exportModel);

  return {
    filename: "collision-iq-line-by-line-report.pdf",
    brand: buildPdfBrand(isComparison ? "Line-by-Line Report" : "Estimate Review"),
    header: buildPdfHeader({
      title: isComparison ? "Line-by-Line Comparison Report" : "Line-by-Line Estimate Review",
      subtitle:
        isComparison
          ? "Operation-focused report showing estimate lines, rationale, and current support status from the shared normalized export model."
          : "Operation-focused estimate review showing documented lines, rationale, and current support status from the shared normalized export model.",
      generatedLabel: `Generated ${source.generatedLabel}`,
    }),
    summary: [
      { label: "Vehicle", value: vehicleIdentity },
      { label: "VIN", value: vin },
      ...(insurer
        ? [{ label: "Insurer", value: insurer }]
        : []),
      ...(typeof exportModel.reportFields.mileage === "number"
        ? [{ label: "Mileage", value: exportModel.reportFields.mileage.toLocaleString("en-US") }]
        : []),
      ...(typeof exportModel.reportFields.estimateTotal === "number"
        ? [{
            label: "Estimate Total",
            value: `$${exportModel.reportFields.estimateTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          }]
        : []),
      { label: "Lines", value: `${source.lineItems.length}` },
      { label: "Focus", value: "Operations, rationale, support status" },
    ],
    sections: source.lineItems.slice(0, 14).map((item, index) => ({
      title: `Line ${index + 1}: ${item.operation}`,
      bullets: [
        `Component: ${item.component}`,
        item.rawLine ? `Estimate line: ${item.rawLine}` : undefined,
        `${isComparison ? "Carrier position" : "Support posture"}: ${item.carrierPosition}`,
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
