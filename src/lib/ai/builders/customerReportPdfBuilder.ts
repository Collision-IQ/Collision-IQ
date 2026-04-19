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
        "Simple, customer-friendly explanation of the repair situation and what the next steps mean.",
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
        title: "Overview",
        body: report.overview,
      },
      {
        title: "What Was Found",
        bullets: withFallback(report.whatWasFound),
      },
      {
        title: "What Needs To Happen",
        bullets: withFallback(report.whatNeedsToHappen),
      },
      {
        title: "Why These Repairs Matter",
        body: report.whyTheseRepairsMatter,
      },
      {
        title: "Safety And Technology",
        bullets: withFallback(report.safetyAndTechnology),
      },
      {
        title: "What May Still Need To Be Confirmed",
        bullets: withFallback(report.whatMayStillNeedToBeConfirmed),
      },
      {
        title: "What The Customer Should Expect",
        bullets: withFallback(report.whatTheCustomerShouldExpect),
      },
      {
        title: "Reassurance",
        body: report.reassurance,
      },
    ],
    footer: [
      "This report is intended to explain the repair situation in plain language for the vehicle owner.",
      "Final repair decisions should be confirmed by the repair facility after inspection, teardown, and required post-repair checks.",
    ],
  };
}

function withFallback(items: string[]): string[] {
  return items.length > 0 ? items : ["None noted."];
}
