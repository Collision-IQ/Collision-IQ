import type { CustomerReport } from "@/lib/ai/generateCustomerReport";
import type { CarrierReportDocument } from "./carrierPdfBuilder";
import type { ConfidenceIntegrity, OEMContradiction, ReportFindingReasoning } from "@/lib/ai/types/analysis";

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
        title: "What This Means For You",
        body: report.openingSummary,
      },
      ...(confidenceIntegrity
        ? [{
            title: "File Coverage / Evidence Completeness",
            bullets: buildPlainConfidenceBullets(confidenceIntegrity),
          }]
        : []),
      {
        title: "Which Repair Plan Looks Stronger",
        body: report.whichRepairPlanLooksStronger,
      },
      {
        title: "Safety Comes First",
        body: report.safetyFirst,
      },
      {
        title: "What Still Needs Proof",
        bullets: withFallback(report.whatStillNeedsProof),
      },
      ...(findingReasoning.length > 0
        ? [{
            title: "Why These Items Matter",
            bullets: findingReasoning.slice(0, 5).map((finding) =>
              `${finding.issue}: ${finding.rationaleSummary ?? finding.why_it_matters} Evidence: ${finding.evidenceChainSummary ?? finding.what_proves_it} Risk if omitted: ${finding.riskIfOmitted ?? "The repair position may be harder to support."} Support: ${formatLabel(finding.supportConfidenceIndicator ?? finding.evidenceLevel)}.`
            ),
          }]
        : []),
      ...(oemContradictions.length > 0
        ? [{
            title: "OEM Support Conflicts",
            bullets: oemContradictions.slice(0, 4).map((contradiction) =>
              `${contradiction.affectedOperation}: ${contradiction.conflictSummary} OEM support: ${contradiction.oemSupportCitation ?? "inferred only; verify OEM support before relying on it."} Follow-up: ${contradiction.recommendedFollowUp}`
            ),
          }]
        : []),
      {
        title: "Your Options Moving Forward",
        bullets: withFallback(report.yourOptions),
      },
      {
        title: "Bottom Line",
        body: report.bottomLine,
      },
    ],
    footer: [
      "This report is intended to explain the repair situation in plain language for the vehicle owner. Final repair decisions should still be confirmed by the repair facility after inspection, teardown, measurement, scan, calibration, and post-repair verification as required.",
    ],
  };
}

function buildPlainConfidenceBullets(integrity: ConfidenceIntegrity): string[] {
  return [
    `Adjusted confidence: ${integrity.adjustedConfidence}.`,
    `File coverage: ${integrity.completenessStatus.toLowerCase()}.`,
    `Files reviewed: ${integrity.uploadedFileCount}.`,
    integrity.userFacingDisclosure,
    ...(integrity.missingCriticalEvidence.length > 0
      ? [`Still needed: ${integrity.missingCriticalEvidence.join(", ")}.`]
      : []),
  ];
}

function withFallback(items: string[]): string[] {
  return items.length > 0 ? items : ["None noted."];
}

function formatLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
