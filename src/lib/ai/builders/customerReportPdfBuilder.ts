import type { CustomerReport } from "@/lib/ai/generateCustomerReport";
import type { CarrierReportDocument } from "./carrierPdfBuilder";

type BuildCustomerReportPdfParams = {
  report: CustomerReport;
  vehicle: string;
  vin?: string | null;
  insurer?: string | null;
  mileage?: string | null;
  estimateTotal?: string | null;
  generatedAt?: string;
  filename?: string;
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

function withFallback(items: string[]): string[] {
  return items.length > 0 ? items : ["None noted."];
}
