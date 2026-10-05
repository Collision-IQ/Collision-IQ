/**
 * RO 22120 review (2026-10-04), item 7: Forensic Estimate Analysis wording
 * must match the evidence it was given.
 *
 * - No policy is among the documents compared, so the owner note cannot say
 *   the policy "contains" an appraisal clause.
 * - Hub, caliper and brake lines arrive with the generic
 *   structural_or_fit_verification category; filed under "structural repair"
 *   they read as structural work.
 * - The wheel-access finding called the shop's rows "Carrier/source rows" and
 *   reported no wheel access on the carrier's sheet, which prints
 *   "LT/Front R&I wheel" and "LT/Rear R&I wheel"; its flattened text glues the
 *   next column on ("wheel00.00m0.1"). It also anchored on "RT Wheel opng
 *   mldg", CCC's abbreviation of a wheel-opening molding.
 *
 * Inputs are de-identified: line text in the shape the prints carry.
 */
import { describe, expect, it } from "vitest";
import { buildForensicReportPdf, forensicDomainOf } from "../forensicReportRenderer";
import { buildForensicReconciliation } from "../forensicEstimateAnalysis";
import { isWheelLaborAnchorText, summarizeComparisonEvidence } from "../annotatedCitationDensityEstimate";
import type { CitationDensityFinding } from "@/lib/ai/types/estimateScrubber";

const finding = (operationLabel: string, category = "structural_or_fit_verification") =>
  ({
    id: operationLabel,
    operationLabel,
    category,
    estimateGapType: "missing_from_carrier",
    currentSupportSummary: "Documented on the higher estimate, absent on the comparison.",
  }) as CitationDensityFinding;

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  return pages.join("\n").replace(/\s+/g, " ");
}

describe("findings are filed under the section that names their component", () => {
  it("hub, caliper and brake lines go to suspension, steering and brakes", () => {
    for (const label of [
      "Missing from comparison estimate: LT Hub assy 150mm",
      "Missing from comparison estimate: LT Caliper w/o Performance",
      "Missing from comparison estimate: Bleed brake system",
      "Missing from comparison estimate: LT Hub assy mount bolt",
      "Priced differently on comparison estimate: Four wheel suspension alignment",
    ]) {
      expect(forensicDomainOf(finding(label))).toBe("mechanical");
    }
  });

  it("structural work stays structural, and refinish on a mechanical part stays refinish", () => {
    expect(forensicDomainOf(finding("Missing from comparison estimate: RT Rocker rail section"))).toBe("structural");
    expect(forensicDomainOf(finding("Comparison estimate allows less paint/refinish: Blnd LT Hub cover", "refinish"))).toBe("refinish");
  });
});

describe("the forensic report states only what its documents show", () => {
  it("does not assert an appraisal clause, and Appendix A shows hours beside a price that excludes labor", async () => {
    const result = await buildForensicReportPdf({
      reconciliation: buildForensicReconciliation({
        higherTotals: {
          categories: [{ category: "Mechanical Labor", hours: 2.6, rate: 175, cost: 455 }],
          subtotal: 455, salesTax: 0, grandTotal: 455, taxLanes: [],
        },
        lowerTotals: { categories: [], subtotal: 0, salesTax: 0, grandTotal: 0, taxLanes: [] },
      }),
      findings: [finding("Missing from comparison estimate: LT Hub assy 150mm")],
      higherDocumentName: "Shop estimate.pdf",
      lowerDocumentName: "Carrier SOR.pdf",
      higherLineCount: 2,
      lowerLineCount: 0,
      noCounterpartRows: [
        { line: 40, description: "Repl LT Hub assy 150mm", amount: 330, laborHours: 1.6, laborType: "M", paintHours: 0 },
        { line: 72, description: "Rpr In-Proc repair scan", amount: 0, laborHours: 1.0, laborType: "M", paintHours: null },
      ],
      vehicleLabel: "Synthetic test vehicle",
      limitations: [],
      authorities: [],
      retrievedSources: [],
      generatedAt: "2026-10-04T00:00:00.000Z",
    });
    const text = await pdfText(result.bytes);
    expect(text).not.toMatch(/your policy contains an appraisal clause/i);
    expect(text).toMatch(/check whether your policy has an appraisal clause/i);
    expect(text).toMatch(/Price \(no labor\)/);
    expect(text).toMatch(/does not include labor/);
    expect(text).toMatch(/40 Repl LT Hub assy 150mm 1\.6 M — \$330\.00/);
    expect(text).toMatch(/72 Rpr In-Proc repair scan 1\.0 M — \$0\.00/);
  });
});

describe("the wheel-access finding reads the comparison's wheel lines", () => {
  // The carrier's sheet as its flattened text layer reads (columns glued).
  const carrierText = [
    "16S01R&IRT Wheel opng mldg00.00Incl.0.0",
    "24*S02SublLT/Front Wheel, alloy 19\"1189.99m0.00.0",
    "26S02ReplLT/Front Wheel cover 19\"SYN0000261151.000.00.0",
    "28S02R&ILT/Front R&I wheel00.00m0.10.0",
    "29S02R&ILT/Rear R&I wheel00.00m0.10.0",
    "Power Passenger SeatDual Air ConditionTraction ControlAluminum/Alloy Wheels",
  ].join("\n");

  it("finds positioned wheel R&I lines whose next column is glued on, and not covers or moldings", () => {
    const summary = summarizeComparisonEvidence(carrierText, /wheel|rim|tire|alignment|access|r&i|remove|install|replacement|repl/i);
    expect(summary).toMatch(/LT\/Front R&I wheel/);
    expect(summary).toMatch(/LT\/Rear R&I wheel/);
    expect(summary).not.toMatch(/cover|opng mldg/);
  });

  it("a wheel-opening molding printed as 'opng mldg' is not wheel labor", () => {
    expect(isWheelLaborAnchorText("21 r i rt wheel opng mldg 0 0.00 incl. 0.0")).toBe(false);
    expect(isWheelLaborAnchorText("30 repl lt front wheel alloy 19 700.00 m 0.3 m 0.0")).toBe(true);
  });
});
