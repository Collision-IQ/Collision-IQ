import type { CarrierReportDocument } from "./carrierPdfBuilder";
import { buildExportTemplateSourceModel, type ExportBuilderInput } from "./exportTemplates";
import {
  buildPreferredRebuttalSubjectVehicleLabel,
  preferCanonicalField,
  resolveCanonicalInsurer,
  resolveCanonicalVehicleLabel,
  resolveCanonicalVin,
  type ExportSupplementItem,
} from "./buildExportModel";
import { buildRebuttalOpeningLine, buildRebuttalClosingCta, type PressureMode } from "./pressureMode";
import { cleanOperationDisplayText } from "../../ui/presentationText";

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

  const numberedAsks = buildNumberedRevisionAsks(rebuttalItems);

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
      { label: "Open Items", value: String(rebuttalItems.length) },
      { label: "Format", value: "Negotiation email draft" },
      { label: "Approach", value: exportModel.pressureMode.mode.charAt(0).toUpperCase() + exportModel.pressureMode.mode.slice(1) },
    ],
    sections: [
      {
        title: "Recommended Subject",
        body: `Request for Estimate Revision - ${subjectVehicle}`,
      },
      {
        title: "Revision Asks",
        bullets: numberedAsks.map(
          (ask) =>
            `${ask.number}. ${ask.issue} - Evidence: ${ask.evidence} - Requested action: ${ask.requestedAction}`
        ),
      },
      {
        title: "Editable Email Body",
        body: buildEmailBody({
          subjectVehicle,
          insurer: insurer ?? null,
          numberedAsks,
          pressureMode: exportModel.pressureMode.mode,
          repairPosition: exportModel.repairPosition,
        }),
      },
    ],
    footer: buildPdfFooter(),
  };
}

type RevisionAsk = {
  number: number;
  issue: string;
  evidence: string;
  requestedAction: string;
};

function buildNumberedRevisionAsks(items: ExportSupplementItem[]): RevisionAsk[] {
  return items.map((item, i) => ({
    number: i + 1,
    issue: displayOperationLabel(item.title),
    evidence: buildEvidenceDescription(item),
    requestedAction: buildRequestedAction(item),
  }));
}

function buildEvidenceDescription(
  item: { kind: string; rationale: string; evidence?: string }
): string {
  const cleanedEvidence = stripGenericNarrative(item.evidence ?? "");
  if (cleanedEvidence) {
    return cleanedEvidence;
  }

  const cleanedRationale = stripGenericNarrative(item.rationale);
  if (cleanedRationale) {
    return cleanedRationale;
  }

  switch (item.kind) {
    case "missing_operation":
      return "The current estimate does not show the requested operation as a separate line.";
    case "missing_verification":
      return "The file does not show the verification record tied to this item.";
    case "underwritten_operation":
      return "The estimate shows the item, but the allowance appears narrower than the documented repair need.";
    case "disputed_repair_path":
      return "The estimate and repair position do not align on the repair method.";
    default:
      return "The current file identifies this as an unresolved estimate item.";
  }
}

function buildRequestedAction(
  item: { kind: string; priority: string; rationale: string }
): string {
  const lower = item.rationale.toLowerCase();
  if (/safety|airbag|adas|calibration|srs|scan/.test(lower)) {
    return "Add or explain the scan, calibration, aiming, or safety-system verification line.";
  }
  if (/structural|measurement|frame|rail|unibody/.test(lower)) {
    return "Add or explain the structural measurement, alignment, or geometry verification allowance.";
  }
  if (/corrosion|cavity wax|weld|seam/.test(lower)) {
    return "Add or explain the corrosion-protection material and labor allowance.";
  }
  if (/paint|blend|refinish|finish/.test(lower)) {
    return "Add or explain the refinish, blend, finish, or quality-control allowance.";
  }
  if (item.kind === "underwritten_operation") {
    return "Revise the allowance or provide the estimating basis for the reduced amount.";
  }
  if (item.priority === "high") {
    return "Revise the estimate or identify the specific file evidence used to deny the item.";
  }
  return "Revise the estimate or provide a written line-item explanation.";
}

function buildEmailBody(params: {
  subjectVehicle: string;
  insurer: string | null;
  numberedAsks: RevisionAsk[];
  pressureMode: PressureMode;
  repairPosition: string;
}): string {
  const greeting = params.insurer
    ? `Hello ${params.insurer} Claims Team,`
    : "Hello,";

  const openingLine = buildRebuttalOpeningLine(
    params.pressureMode,
    params.subjectVehicle,
    params.repairPosition
  );

  const closingCta = buildRebuttalClosingCta(params.pressureMode);

  const asksBlock = params.numberedAsks.length > 0
    ? params.numberedAsks.map((ask) =>
        `${ask.number}. ${ask.issue}\n   Evidence: ${ask.evidence}\n   Requested action: ${ask.requestedAction}`
      ).join("\n\n")
    : "   Please review the current estimate and identify the file evidence supporting any denied or reduced items.";

  return [
    greeting,
    "",
    openingLine,
    "",
    asksBlock,
    "",
    closingCta,
    "",
    "Regards,",
    "[Your Name]",
    "[Title / Shop]",
    "[Phone / Email]",
  ].join("\n");
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
    "This PDF is intended as an editable carrier-facing negotiation draft.",
    "Review and adjust the final language as needed before sending or filing.",
  ];
}

function displayOperationLabel(value: string | undefined): string {
  return cleanOperationDisplayText(value) || value || "";
}

function stripGenericNarrative(value: string): string {
  return value
    .replace(/\bcredible preliminary repair plan\b/gi, "")
    .replace(/\bsupport remains open\b/gi, "documentation is not shown")
    .replace(/\brepair path appears supportable\b/gi, "the repair item is identified")
    .replace(/\bprocedure support should not be treated as no support\b/gi, "")
    .replace(/\bfile documents several parts\b/gi, "the estimate identifies specific items")
    .replace(/\bcurrent file set supports\b/gi, "the file evidence identifies")
    .replace(/\bthe narrative supports\b/gi, "the file evidence identifies")
    .replace(/\s+/g, " ")
    .trim();
}
