import type { DecisionPanel } from "./buildDecisionPanel";
import type { AnalysisResult, RepairIntelligenceReport } from "../types/analysis";
import type { CarrierReportDocument } from "./carrierPdfBuilder";
import { buildExportTemplateSourceModel } from "./exportTemplates";
import {
  buildPreferredRebuttalSubjectVehicleLabel,
  buildPreferredVehicleIdentityLabel,
} from "./buildExportModel";

export function buildRebuttalEmailPdf(params: {
  report: RepairIntelligenceReport | null;
  analysis: AnalysisResult | null;
  panel: DecisionPanel | null;
  assistantAnalysis?: string | null;
}): CarrierReportDocument {
  const source = buildExportTemplateSourceModel(params);
  const { exportModel } = source;
  const rebuttalItems = exportModel.supplementItems.slice(0, 5);
  const vehicleIdentity =
    exportModel.reportFields.vehicleLabel ??
    buildPreferredVehicleIdentityLabel(exportModel.vehicle) ??
    "Unspecified";
  const subjectVehicle = buildPreferredRebuttalSubjectVehicleLabel(exportModel.vehicle);

  return {
    filename: "collision-iq-rebuttal-email.pdf",
    brand: buildPdfBrand("Rebuttal Email"),
    header: buildPdfHeader({
      title: "Carrier Rebuttal Email",
      subtitle:
        "Editable carrier-facing summary built from the current normalized repair analysis and support items.",
      generatedLabel: `Generated ${source.generatedLabel}`,
    }),
    summary: [
      { label: "Vehicle", value: vehicleIdentity },
      { label: "VIN", value: exportModel.reportFields.vin || exportModel.vehicle.vin || "Unspecified" },
      ...(exportModel.reportFields.insurer
        ? [{ label: "Insurer", value: exportModel.reportFields.insurer }]
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
      { label: "Primary Ask", value: rebuttalItems[0]?.title || "Review the current repair path and provide supporting documentation." },
      { label: "Format", value: "Professional email draft" },
    ],
    sections: [
      {
        title: "Recommended Subject",
        body: `Request for estimate revision - ${subjectVehicle}`,
      },
      {
        title: "Opening Position",
        body: `After reviewing the current file, our position is that ${lowercaseFirst(exportModel.repairPosition)}`,
      },
      {
        title: "Requested Revisions / Support",
        bullets:
          rebuttalItems.length > 0
            ? rebuttalItems.map(
                (item) =>
                  `${item.title}: ${item.rationale}${item.evidence ? ` Evidence: ${item.evidence}` : ""}`
              )
            : ["Please review the current repair path and provide any supporting documentation needed to confirm the intended scope."],
      },
      {
        title: "Editable Email Body",
        body: [
          "Hello,",
          "",
          `After reviewing the current file, our position is that ${lowercaseFirst(exportModel.repairPosition)}`,
          "",
          "The main items that still need revision or support are:",
          ...(
            rebuttalItems.length > 0
              ? rebuttalItems.map((item) => `- ${item.title}: ${item.rationale}`)
              : ["- Please review the current repair path and provide supporting documentation."]
          ),
          "",
          "Please update the estimate or provide the documentation supporting the current position on the items above.",
          "",
          "Thank you,",
          "[Your Name]",
          "[Title / Shop]",
          "[Phone / Email]",
        ].join("\n"),
      },
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

function lowercaseFirst(value: string): string {
  if (!value) return value;
  return value.charAt(0).toLowerCase() + value.slice(1);
}
