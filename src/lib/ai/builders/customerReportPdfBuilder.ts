import type { CustomerReport } from "@/lib/ai/generateCustomerReport";
import type { CarrierReportDocument } from "./carrierPdfBuilder";
import type { EstimateComparisonTotals } from "./buildExportModel";
import type { ConfidenceIntegrity, OEMContradiction, ReportFindingReasoning } from "@/lib/ai/types/analysis";
import {
  alignCustomerEstimatePostureText,
  stripEstimateComparisonLanguage,
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
  comparisonTotals?: EstimateComparisonTotals | null;
  generatedAt?: string;
  filename?: string;
  confidenceIntegrity?: ConfidenceIntegrity;
  findingReasoning?: ReportFindingReasoning[];
  oemContradictions?: OEMContradiction[];
  selectedEstimatePosture?: EstimatePostureDecision;
};

function formatCustomerMoney(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Show both estimate totals (shop and carrier) plus the difference when a
 * comparison is available, with any net-after-deductible figure listed
 * separately from the repair total. Falls back to a single "Estimate Total"
 * only when no comparison totals were extracted. Never presents the carrier
 * total alone as the headline figure.
 */
export function buildCustomerTotalsSummary(
  comparisonTotals: EstimateComparisonTotals | null | undefined,
  estimateTotal: string | null | undefined
): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  const shop = comparisonTotals?.shopEstimateGrandTotal;
  const carrier = comparisonTotals?.carrierTotalCostOfRepairs;
  const net = comparisonTotals?.carrierNetAfterDeductible;
  const gap = comparisonTotals?.grossRepairAppraisalGap;

  if (typeof shop === "number") {
    rows.push({ label: "Shop estimate total", value: formatCustomerMoney(shop) });
  }
  if (typeof carrier === "number") {
    rows.push({ label: "Carrier total cost of repairs", value: formatCustomerMoney(carrier) });
  }
  if (typeof shop === "number" && typeof carrier === "number") {
    const difference = typeof gap === "number" ? Math.abs(gap) : Math.abs(shop - carrier);
    rows.push({ label: "Difference", value: formatCustomerMoney(difference) });
  }
  // Net/payable is shown separately from the repair total, never as the basis.
  if (typeof net === "number") {
    rows.push({ label: "Carrier net after deductible", value: formatCustomerMoney(net) });
  }

  if (rows.length === 0) {
    rows.push({ label: "Estimate Total", value: estimateTotal || "Not provided" });
  }
  return rows;
}

/**
 * Format the mileage line. When the estimates disagree on odometer, show both
 * readings and label the gap (minor when within ~1,000 mi) rather than hiding
 * it behind a single value. Falls back to the single mileage otherwise.
 */
export function formatMileageDisplay(
  mileage: number | null | undefined,
  readings?: number[] | null
): string | null {
  const distinct = [...new Set((readings ?? []).filter((v) => Number.isFinite(v) && v > 0))].sort(
    (a, b) => a - b
  );
  if (distinct.length >= 2) {
    const lo = distinct[0];
    const hi = distinct[distinct.length - 1];
    const diff = hi - lo;
    // Label an odometer difference across documents as a paperwork mismatch to
    // verify, not a repair defect. Small gaps read as minor; larger gaps flag a
    // document mismatch requiring verification (e.g. a possible different reading
    // date or record error), not necessarily a repair issue.
    const note =
      diff <= 1000
        ? `minor discrepancy of ${diff.toLocaleString("en-US")} mi across estimates`
        : `${diff.toLocaleString("en-US")} mi document mismatch across estimates — verify before relying on it; not necessarily a repair issue`;
    return `${distinct.map((v) => v.toLocaleString("en-US")).join(" / ")} (${note})`;
  }
  if (typeof mileage === "number" && mileage > 0) return mileage.toLocaleString("en-US");
  if (distinct.length === 1) return distinct[0].toLocaleString("en-US");
  return null;
}

export function buildCustomerReportPdf({
  report,
  vehicle,
  vin,
  insurer,
  mileage,
  estimateTotal,
  comparisonTotals,
  generatedAt,
  filename,
  confidenceIntegrity,
  findingReasoning = [],
  oemContradictions = [],
  selectedEstimatePosture,
}: BuildCustomerReportPdfParams): CarrierReportDocument {
  const sanitizedReport = sanitizeCustomerReportForRender(report);
  const comparisonAvailable = selectedEstimatePosture
    ? selectedEstimatePosture.comparisonAvailable !== false
    : typeof comparisonTotals?.shopEstimateGrandTotal === "number" &&
      typeof comparisonTotals?.carrierTotalCostOfRepairs === "number";
  const singleEstimateScrub = (text: string) =>
    comparisonAvailable ? text : stripEstimateComparisonLanguage(text);
  const estimatePostureBody = selectedEstimatePosture
    ? alignCustomerEstimatePostureText(sanitizedReport.whichRepairPlanLooksStronger, selectedEstimatePosture)
    : singleEstimateScrub(sanitizedReport.whichRepairPlanLooksStronger);
  const estimatePrecisionNote = buildEstimatePrecisionNote(sanitizedReport, findingReasoning);
  const cccDisclosure = buildCccDisclosure(report, findingReasoning, oemContradictions);
  // Scrub BEFORE the customer-facing list sanitizer runs — it collapses
  // redaction tokens into forms the scrubber no longer recognizes.
  const possibleMissingItems = buildPossibleMissingItems({
    report: sanitizedReport,
    confidenceIntegrity,
    findingReasoning,
    oemContradictions,
    transform: singleEstimateScrub,
  }).map(singleEstimateScrub);
  const verificationItems = buildVerificationItems({
    report: sanitizedReport,
    confidenceIntegrity,
    findingReasoning,
    transform: singleEstimateScrub,
  }).map(singleEstimateScrub);
  const askForItems = buildAskForItems(sanitizedReport, singleEstimateScrub).map(singleEstimateScrub);

  // Approved customer-facing section order — these exact headings are the
  // contract; the prose sanitizer must not re-case them.
  const APPROVED_SECTION_TITLES = [
    "Plain-English Summary",
    "What This Means for You",
    "Key Findings",
    "Why These Items Matter",
    "Questions to Ask",
    "Supporting Documentation",
    "Technical Appendix",
  ];

  const sanitizedDocument = sanitizeCustomerFacingDocument({
    filename: filename || "customer-report.pdf",
    brand: {
      companyName: "Collision Academy",
      reportLabel: "Customer Report",
      logoPath: "/brand/logos/logo-horizontal.png",
    },
    header: {
      title: sanitizedReport.title || "Customer Report",
      subtitle:
        "A plain-language explanation of the repair plan, what is supported, what still needs proof, and the practical next steps.",
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
      ...buildCustomerTotalsSummary(comparisonTotals, estimateTotal),
    ],
    // Approved customer-facing section order — keep these headings stable.
    sections: [
      {
        title: "Plain-English Summary",
        body: [
          toCustomerFacingText(
            singleEstimateScrub(sanitizedReport.openingSummary),
            "The current file gives us enough information to explain the repair concerns in plain language."
          ),
        ].filter(Boolean).join(" "),
      },
      {
        title: "What This Means for You",
        body: toCustomerFacingText(
          [estimatePrecisionNote, estimatePostureBody, singleEstimateScrub(sanitizedReport.bottomLine)]
            .filter(Boolean)
            .join(" "),
          "The safest next step is to have the estimate reviewed against the actual repair needs before treating it as complete."
        ),
      },
      {
        title: "Key Findings",
        bullets: possibleMissingItems,
      },
      {
        title: "Why These Items Matter",
        body: toCustomerFacingText(
          singleEstimateScrub(sanitizedReport.safetyFirst),
          "These checks matter because the vehicle should be repaired, fitted, scanned, and verified before it is returned to normal use."
        ),
      },
      {
        title: "Questions to Ask",
        bullets: askForItems,
      },
      {
        title: "Supporting Documentation",
        bullets: [
          ...verificationItems,
          "If repairs are complete, request the final invoice, scan, calibration, alignment, and delivery documentation.",
        ].slice(0, 7),
      },
      {
        title: "Technical Appendix",
        bullets: [
          cccDisclosure,
          "Repair completion status is not established from the reviewed file.",
          "If repairs are ongoing, open items should remain available for supplement review.",
          comparisonAvailable
            ? "The insurer or repair shop should be able to explain whether each concern is already included in the estimate."
            : "The repair shop should be able to explain whether each concern is already included in the estimate.",
          "If something is not included, ask why it was left out and whether it will be reviewed as a supplement.",
        ].filter(Boolean),
      },
    ],
    footer: [
      "This report is intended to explain the repair situation in plain language for the vehicle owner. Final repair decisions should still be confirmed by the repair facility after inspection, teardown, measurement, scan, calibration, and post-repair verification as required.",
    ],
  });

  return {
    ...sanitizedDocument,
    sections: sanitizedDocument.sections.map((section, index) => ({
      ...section,
      title: APPROVED_SECTION_TITLES[index] ?? section.title,
    })),
  };
}

function buildPossibleMissingItems(params: {
  report: CustomerReport;
  confidenceIntegrity?: ConfidenceIntegrity;
  findingReasoning: ReportFindingReasoning[];
  oemContradictions: OEMContradiction[];
  transform?: (text: string) => string;
}) {
  const transform = params.transform ?? ((text: string) => text);
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
    ].map(transform),
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
  transform?: (text: string) => string;
}) {
  const transform = params.transform ?? ((text: string) => text);
  return toCustomerFacingList(
    [
      ...params.report.whatStillNeedsProof,
      ...(params.confidenceIntegrity?.missingCriticalEvidence ?? []),
      ...params.findingReasoning.slice(0, 5).map((finding) => finding.next_action),
    ].map(transform),
    [
      "Not verified from the reviewed file. Request final invoice, scan, calibration, alignment, and delivery documentation if repairs are complete.",
    ]
  ).slice(0, 6);
}

function buildAskForItems(
  report: CustomerReport,
  transform: (text: string) => string = (text) => text
) {
  return toCustomerFacingList(
    [
      ...report.yourOptions,
      "Ask the insurer or repair shop to explain whether this item is included, and if not, why.",
      "Ask what documentation is not produced in the reviewed file and what would be handled as a supplement if repairs are ongoing.",
    ].map(transform),
    [
      transform("Ask the insurer or repair shop to explain whether each item is included, and if not, why."),
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
