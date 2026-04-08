import type { CarrierReportDocument } from "./carrierPdfBuilder";
import { buildExportTemplateSourceModel, type ExportBuilderInput } from "./exportTemplates";
import {
  buildPreferredRebuttalSubjectVehicleLabel,
  preferCanonicalField,
  resolveCanonicalInsurer,
  resolveCanonicalVehicleLabel,
  resolveCanonicalVin,
} from "./buildExportModel";

export function buildRebuttalEmailPdf(params: ExportBuilderInput): CarrierReportDocument {
  const source = buildExportTemplateSourceModel(params);
  const { exportModel } = source;
  const rebuttalItems = exportModel.supplementItems.slice(0, 5);
  const vehicleIdentity = resolveCanonicalVehicleLabel(exportModel) ?? "Unspecified";
  const vin = resolveCanonicalVin(exportModel) ?? "Unspecified";
  const insurer = resolveCanonicalInsurer(exportModel);
  const subjectVehicle =
    preferCanonicalField(
      exportModel.reportFields.vehicleLabel,
      buildPreferredRebuttalSubjectVehicleLabel(exportModel.vehicle)
    ) ?? "Current repair file";
  const openingPosition = buildCarrierOpening(exportModel.repairPosition);

  return {
    filename: "collision-iq-rebuttal-email.pdf",
    brand: buildPdfBrand("Rebuttal Email"),
    header: buildPdfHeader({
      title: "Carrier Rebuttal Email",
      subtitle:
        "Editable carrier-facing summary based on the current estimate review and supporting file material.",
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
      { label: "Primary Ask", value: rebuttalItems[0]?.title || "Review the current estimate support and provide any needed documentation." },
      { label: "Format", value: "Professional email draft" },
    ],
    sections: [
      {
        title: "Recommended Subject",
        body: `Request for estimate revision - ${subjectVehicle}`,
      },
      {
        title: "Opening Position",
        body: openingPosition,
      },
      {
        title: "Requested Revisions / Support",
        bullets:
          rebuttalItems.length > 0
            ? rebuttalItems.map(
                (item) =>
                  `${item.title}: ${item.rationale}${item.evidence ? ` Support noted: ${item.evidence}` : ""}`
              )
            : ["Please review the current estimate support and provide any documentation needed to confirm the intended scope."],
      },
      {
        title: "Editable Email Body",
        body: [
          "Hello,",
          "",
          openingPosition,
          "",
          rebuttalItems.length > 0
            ? "The file would benefit from clearer support on the following items:"
            : "Please review the current estimate support and related documentation:",
          ...(
            rebuttalItems.length > 0
              ? rebuttalItems.map((item) => `- ${item.title}: ${item.rationale}`)
              : ["- Please review the current estimate support and provide supporting documentation."]
          ),
          "",
          "Please update the estimate or provide any documentation that clarifies the current position on the items above.",
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
    "This PDF is intended as an editable carrier-facing summary of the current estimate review.",
    "Review and edit the final carrier-facing language as needed before sending or filing.",
  ];
}

function buildCarrierOpening(repairPosition: string): string {
  const normalized = trimTrailingPunctuation(repairPosition);
  if (!normalized) {
    return "The current file supports a focused estimate review.";
  }

  if (/^(based on|across|from|the file|the current file|documented file facts|support appears)\b/i.test(normalized)) {
    return normalized + ".";
  }

  return `Based on the current file, ${lowercaseFirst(normalized)}.`;
}

function lowercaseFirst(value: string): string {
  if (!value) return value;
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function trimTrailingPunctuation(value: string): string {
  return value.replace(/[.!\s]+$/g, "").trim();
}
