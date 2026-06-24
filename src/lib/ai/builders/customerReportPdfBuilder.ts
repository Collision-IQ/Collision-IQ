import type { CustomerReport } from "@/lib/ai/generateCustomerReport";
import type { CarrierReportDocument } from "./carrierPdfBuilder";
import type { ConfidenceIntegrity, OEMContradiction, ReportFindingReasoning } from "@/lib/ai/types/analysis";
import {
  alignCustomerEstimatePostureText,
  buildCustomerEstimatePostureHeading,
  type EstimatePostureDecision,
} from "@/lib/ai/estimatePosture";
import {
  containsCccWorkfileSignal,
  sanitizeCustomerFacingDocument,
  sanitizeCustomerReportForRender,
  toCustomerFacingList,
  toCustomerFacingText,
} from "@/lib/ai/customerFacingText";

type BuildCustomerReportPdfParams = {
  report: CustomerReport;
  vehicle: string;
  vin?: string | null;
  insurer?: string | null;
  mileage?: string | null;
  estimateTotal?: string | null;
  generatedAt?: string;
  filename?: string;
  confidenceIntegrity?: ConfidenceIntegrity;
  findingReasoning?: ReportFindingReasoning[];
  oemContradictions?: OEMContradiction[];
  selectedEstimatePosture?: EstimatePostureDecision;
};

export function buildCustomerReportPdf({
  report,
  vehicle,
  vin,
  insurer,
  mileage,
  estimateTotal,
  generatedAt,
  filename,
  confidenceIntegrity,
  findingReasoning = [],
  oemContradictions = [],
  selectedEstimatePosture,
}: BuildCustomerReportPdfParams): CarrierReportDocument {
  const sanitizedReport = sanitizeCustomerReportForRender(report);
  const estimatePostureHeading = selectedEstimatePosture
    ? buildCustomerEstimatePostureHeading(selectedEstimatePosture)
    : "Why The Shop Estimate Looks More Complete";
  const estimatePostureBody = selectedEstimatePosture
    ? alignCustomerEstimatePostureText(sanitizedReport.whichRepairPlanLooksStronger, selectedEstimatePosture)
    : sanitizedReport.whichRepairPlanLooksStronger;
  const estimatePrecisionNote = buildEstimatePrecisionNote(sanitizedReport, findingReasoning);
  const cccDisclosure = buildCccDisclosure(report, findingReasoning, oemContradictions);
  const possibleMissingItems = buildPossibleMissingItems({
    report: sanitizedReport,
    confidenceIntegrity,
    findingReasoning,
    oemContradictions,
  });
  const verificationItems = buildVerificationItems({
    report: sanitizedReport,
    confidenceIntegrity,
    findingReasoning,
  });
  const askForItems = buildAskForItems(sanitizedReport);

  return sanitizeCustomerFacingDocument({
    filename: filename || "customer-report.pdf",
    brand: {
      companyName: "Collision Academy",
      reportLabel: "Customer Report",
      logoPath: "/brand/logos/logo-horizontal.png",
    },
    header: {
      title: sanitizedReport.title || "Customer Report",
      subtitle:
        "Straight explanation for the vehicle owner about which repair path looks more accurate, what matters for safety, and the practical options from here.",
      generatedLabel:
        generatedAt ||
        `Generated ${new Date().toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}`,
    },
    summary: [
      { label: "Vehicle", value: vehicle || "Not provided" },
      { label: "VIN", value: vin || "Not provided" },
      { label: "Insurer", value: insurer || "Not provided" },
      { label: "Mileage", value: mileage || "Not provided" },
      { label: "Estimate Total", value: estimateTotal || "Not provided" },
    ],
    sections: [
      {
        title: "What We Found",
        body: [
          toCustomerFacingText(
            sanitizedReport.openingSummary,
            "The current file gives us enough information to explain the repair concerns in plain language."
          ),
          cccDisclosure,
        ].filter(Boolean).join(" "),
      },
      {
        title: estimatePostureHeading,
        body: toCustomerFacingText(
          [estimatePrecisionNote, estimatePostureBody].filter(Boolean).join(" "),
          "The shop estimate appears to account for more of the inspection, repair, and verification steps that may be needed."
        ),
      },
      {
        title: "Why The Insurance Estimate May Be Missing Items",
        bullets: possibleMissingItems,
      },
      {
        title: "What Still Needs To Be Verified",
        bullets: verificationItems,
      },
      {
        title: "Why This Matters For Safety And Repair Quality",
        body: toCustomerFacingText(
          sanitizedReport.safetyFirst,
          "These checks matter because the vehicle should be repaired, fitted, scanned, and verified before it is returned to normal use."
        ),
      },
      {
        title: "What You Can Ask For",
        bullets: askForItems,
      },
      {
        title: "What Happens Next",
        bullets: [
          "Repair completion status is not established from the reviewed file.",
          "If repairs are ongoing, this should remain open for supplement review.",
          "If repairs are complete, request the final invoice, scan, calibration, alignment, and delivery documentation.",
          "The insurer or repair shop should be able to explain whether each concern is already included in the estimate.",
          "If something is not included, ask why it was left out and whether it will be reviewed as a supplement.",
        ],
      },
      {
        title: "Bottom Line",
        body: toCustomerFacingText(
          sanitizedReport.bottomLine,
          "The safest next step is to have the estimate reviewed against the actual repair needs before treating it as complete."
        ),
      },
    ],
    footer: [
      "This report is intended to explain the repair situation in plain language for the vehicle owner. Final repair decisions should still be confirmed by the repair facility after inspection, teardown, measurement, scan, calibration, and post-repair verification as required.",
    ],
  });
}

function buildPossibleMissingItems(params: {
  report: CustomerReport;
  confidenceIntegrity?: ConfidenceIntegrity;
  findingReasoning: ReportFindingReasoning[];
  oemContradictions: OEMContradiction[];
}) {
  return toCustomerFacingList(
    [
      ...params.findingReasoning.slice(0, 5).map((finding) =>
        `${finding.issue}: ${finding.why_it_matters || finding.rationaleSummary || finding.next_action}`
      ),
      ...params.oemContradictions.slice(0, 3).map((contradiction) =>
        `${contradiction.affectedOperation}: ${contradiction.conflictSummary}`
      ),
      ...params.report.whatStillNeedsProof,
      ...(params.confidenceIntegrity?.missingCriticalEvidence ?? []),
    ],
    [
      "The reviewed file does not include completion proof for every inspection, fit, scan, calibration, or repair step.",
    ]
  ).slice(0, 6);
}

function buildEstimatePrecisionNote(report: CustomerReport, findingReasoning: ReportFindingReasoning[]): string {
  const text = [
    report.openingSummary,
    report.whichRepairPlanLooksStronger,
    report.safetyFirst,
    report.bottomLine,
    ...report.whatStillNeedsProof,
    ...report.yourOptions,
    ...findingReasoning.map((finding) => `${finding.issue} ${finding.what_proves_it} ${finding.why_it_matters}`),
  ].join(" ");

  if (!/lkq\s+grille|not\s+correct\s+style|a\/m|capa|paint supplies|revvadas|seat belt dynamic/i.test(text)) {
    return "";
  }

  return "The estimate rows show specific differences in part type, labor or material rates, and scan or calibration support where those rows are present. Any part-style concern should stay tied to the exact estimate line that documents it rather than being generalized across unrelated vehicle areas.";
}

function buildVerificationItems(params: {
  report: CustomerReport;
  confidenceIntegrity?: ConfidenceIntegrity;
  findingReasoning: ReportFindingReasoning[];
}) {
  return toCustomerFacingList(
    [
      ...params.report.whatStillNeedsProof,
      ...(params.confidenceIntegrity?.missingCriticalEvidence ?? []),
      ...params.findingReasoning.slice(0, 5).map((finding) => finding.next_action),
    ],
    [
      "Not verified from the reviewed file. Request final invoice, scan, calibration, alignment, and delivery documentation if repairs are complete.",
    ]
  ).slice(0, 6);
}

function buildAskForItems(report: CustomerReport) {
  return toCustomerFacingList(
    [
      ...report.yourOptions,
      "Ask the insurer or repair shop to explain whether this item is included, and if not, why.",
      "Ask what documentation is not produced in the reviewed file and what would be handled as a supplement if repairs are ongoing.",
    ],
    [
      "Ask the insurer or repair shop to explain whether each item is included, and if not, why.",
    ]
  ).slice(0, 6);
}

function buildCccDisclosure(
  report: CustomerReport,
  findingReasoning: ReportFindingReasoning[],
  oemContradictions: OEMContradiction[]
) {
  const hasCcc = containsCccWorkfileSignal([
    report.openingSummary,
    report.whichRepairPlanLooksStronger,
    report.safetyFirst,
    report.bottomLine,
    ...report.whatStillNeedsProof,
    ...report.yourOptions,
    ...findingReasoning.map((finding) => `${finding.issue} ${finding.what_proves_it}`),
    ...oemContradictions.map((contradiction) => contradiction.conflictSummary),
  ]);

  return hasCcc
    ? "CCC Secure Share source confirms this estimate line was present in the structured estimate data."
    : "";
}
