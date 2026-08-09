/**
 * The tier and refusal sections only render when retrieval actually returned
 * something, and the corpus harness has no live Drive/Serper lane — so they
 * would otherwise ship never having been executed once. A throw here takes the
 * whole export down, which is exactly the class of defect that put a Unicode
 * minus into the money formatter unnoticed.
 */
import { describe, it, expect } from "vitest";
import { buildForensicReportPdf } from "../forensicReportRenderer";
import { buildForensicReconciliation } from "../forensicEstimateAnalysis";
import type { CitationDensityFinding } from "@/lib/ai/types/estimateScrubber";

const reconciliation = buildForensicReconciliation({
  higherTotals: {
    categories: [{ category: "Body Labor", hours: 52.7, rate: 90, cost: 4743 }],
    subtotal: 4743, salesTax: 284.58, grandTotal: 5027.58,
    taxLanes: [{ label: "Sales Tax", amount: 284.58 }],
  },
  lowerTotals: {
    categories: [{ category: "Body Labor", hours: 71.5, rate: 95, cost: 6792.5 }],
    subtotal: 6792.5, salesTax: 407.55, grandTotal: 7200.05,
    taxLanes: [{ label: "Sales Tax", amount: 407.55 }],
  },
});

const finding = {
  id: "f1",
  operationLabel: "Missing from comparison estimate: Pre repair scan",
  category: "scan_diagnostic",
  estimateGapType: "missing_from_carrier",
  currentSupportSummary: "Documented on the higher estimate, absent on the comparison.",
  missingProofSummary: "Attach the scan report.",
  recommendedNextAction: "Confirm whether the operation belongs on both documents.",
} as CitationDensityFinding;

describe("the forensic report renders its retrieval sections without throwing", () => {
  it("renders tiered sources and states what it refused to cite", async () => {
    const result = await buildForensicReportPdf({
      reconciliation,
      findings: [finding],
      higherDocumentName: "Shop Final 22059.pdf",
      lowerDocumentName: "SOR-4 22059.pdf",
      higherLineCount: 129,
      lowerLineCount: 124,
      noCounterpartRows: [{ line: 139, description: "Rpr Pre repair scan", amount: null }],
      vehicleLabel: "Tesla",
      limitations: [],
      authorities: [],
      retrievedSources: [
        { title: "Model S (2021+) Collision Repair Procedures", url: "https://service.tesla.com/docs/ModelS/" },
        { title: "31 Pa. Code § 62.3", url: "https://www.pacodeandbulletin.gov/Display/pacode?file=62.3" },
        { title: "Tesla I-CAR", url: "https://rts.i-car.com/oem-information/tesla.html" },
        { title: "OEM procedures aren't just about repair quality Instagram", url: "https://www.instagram.com/p/Cabc/" },
      ],
      generatedAt: "2026-08-09T00:00:00.000Z",
    });
    expect(result.pageCount).toBeGreaterThan(0);
    expect(result.bytes.byteLength).toBeGreaterThan(1000);
  });

  it("renders with a negative gap, the case that crashed WinAnsi encoding", async () => {
    const result = await buildForensicReportPdf({
      reconciliation,
      findings: [],
      higherDocumentName: "A.pdf",
      lowerDocumentName: "B.pdf",
      higherLineCount: null,
      lowerLineCount: null,
      noCounterpartRows: [],
      vehicleLabel: null,
      limitations: ["Comparison supplied as an image-only PDF."],
      authorities: [{ title: "Scan position statement", relevance: "Pre repair scan", where: "Retrieved" }],
      retrievedSources: [],
      generatedAt: "2026-08-09T00:00:00.000Z",
    });
    expect(result.pageCount).toBeGreaterThan(0);
  });
});
