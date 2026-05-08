import type { CustomerReport } from "@/lib/ai/generateCustomerReport";
import type { CarrierReportDocument } from "./carrierPdfBuilder";
import type { ConfidenceIntegrity, OEMContradiction, ReportFindingReasoning } from "@/lib/ai/types/analysis";
import {
  containsCccWorkfileSignal,
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
}: BuildCustomerReportPdfParams): CarrierReportDocument {
  const cccDisclosure = buildCccDisclosure(report, findingReasoning, oemContradictions);
  const possibleMissingItems = buildPossibleMissingItems({
    report,
    confidenceIntegrity,
    findingReasoning,
    oemContradictions,
  });
  const verificationItems = buildVerificationItems({
    report,
    confidenceIntegrity,
    findingReasoning,
  });
  const askForItems = buildAskForItems(report);

  return {
    filename: filename || "customer-report.pdf",
    brand: {
      companyName: "Collision Academy",
      reportLabel: "Customer Report",
      logoPath: "/brand/logos/logo-horizontal.png",
    },
    header: {
      title: report.title || "Customer Report",
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
            report.openingSummary,
            "The current file gives us enough information to explain the repair concerns in plain language."
          ),
          cccDisclosure,
        ].filter(Boolean).join(" "),
      },
      {
        title: "Why The Shop Estimate Looks More Complete",
        body: toCustomerFacingText(
          report.whichRepairPlanLooksStronger,
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
          report.safetyFirst,
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
          "The repair shop can inspect the vehicle further and document any additional damage or repair steps found during teardown.",
          "The insurer or repair shop should be able to explain whether each concern is already included in the estimate.",
          "If something is not included, ask why it was left out and whether it will be reviewed as a supplement.",
        ],
      },
      {
        title: "Bottom Line",
        body: toCustomerFacingText(
          report.bottomLine,
          "The safest next step is to have the estimate reviewed against the actual repair needs before treating it as complete."
        ),
      },
    ],
    footer: [
      "This report is intended to explain the repair situation in plain language for the vehicle owner. Final repair decisions should still be confirmed by the repair facility after inspection, teardown, measurement, scan, calibration, and post-repair verification as required.",
    ],
  };
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
      "The insurance estimate may not yet include every inspection, fit, scan, calibration, or repair step needed after teardown.",
    ]
  ).slice(0, 6);
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
      "The vehicle should be checked after teardown to confirm whether additional repair, alignment, scan, calibration, or fit items are needed.",
    ]
  ).slice(0, 6);
}

function buildAskForItems(report: CustomerReport) {
  return toCustomerFacingList(
    [
      ...report.yourOptions,
      "Ask the insurer or repair shop to explain whether this item is included, and if not, why.",
      "Ask what will be rechecked after teardown and what would be handled as a supplement.",
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
    ? "A CCC workfile was provided, but only supported estimate data was used for this review."
    : "";
}
