/**
 * The totals lane on a supplement print that is the HIGHER estimate.
 *
 * A CCC ONE supplement prints ESTIMATE TOTALS (the estimate's totals, which the
 * totals deltas are computed from) and later a TOTALS SUMMARY of the
 * supplement's own change amounts in the same shape. The lane searches its
 * totals anchors from the end, so a Body Labor rate or Paint Supplies hours
 * finding landed on the summary's change row ("Paint Supplies 3.6 hrs") instead
 * of the row it is about ("Paint Supplies 15.4 hrs").
 *
 * The lane runs only when the annotated estimate is the higher one, and no
 * fixture claim has its supplement above its counterpart. RO 22084 SOR-5
 * ($11,618.63) is annotated against RO 20766 SOR-3 ($7,281.92): two real CCC
 * ONE supplement prints, paired only to reach the lane. Nothing here is
 * asserted about the pairing's line deltas.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  TOTALS_SUMMARY_SECTION,
  buildEstimateRowAnchorsFromLines,
  buildPdfTextLines,
  type EstimateRowAnchor,
  type PdfWord,
} from "../citationDensityRowAnchors";
import { buildRequiredEstimatorDeltaFindings, createTotalsAnchorClaimer } from "../annotatedCitationDensityEstimate";

const FIXTURE_DIR = path.join(__dirname, "../../../../tests/fixtures");
const read = (name: string) => fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8");

describe("totals findings on a supplement annotated as the higher estimate", () => {
  const words = JSON.parse(read("22084/sor5_words.json")) as PdfWord[];
  const visualLines = buildPdfTextLines(words);
  const anchors = buildEstimateRowAnchorsFromLines(visualLines, { sourceDocumentRole: "carrier", sourceDocumentId: "sor5-22084" });
  const generated = buildRequiredEstimatorDeltaFindings({
    anchors,
    visualLines,
    sourcePdfName: "SOR-5 22084.pdf",
    sourceDocumentId: "sor5-22084",
    sourceDocumentRole: "carrier",
    sourcePdfHash: "fixture-22084-sor5",
    uploadedFileNames: ["SOR-5 22084.pdf", "SOR3 20766.pdf"],
    sourceText: read("22084/sor5_text.txt"),
    comparisonEstimateTexts: [{ sourceDocumentId: "sor3-20766", fileName: "SOR3 20766.pdf", text: read("20766/sor3_text.txt"), estimateRole: "carrier" }],
    comparisonEstimateWords: [
      { fileName: "SOR3 20766.pdf", estimateRole: "carrier", words: JSON.parse(read("20766/sor3_words.json")) as PdfWord[], textLayerReliable: true },
    ],
    extractionWarnings: [],
  });
  const byId = new Map(anchors.map((anchor) => [anchor.anchorId, anchor]));
  const totals = generated.findings
    .filter((finding) => finding.id.startsWith("required-detector-totals-"))
    .map((finding) => ({ id: finding.id, anchor: byId.get(finding.carrierAnchor?.anchorId ?? "") as EstimateRowAnchor }));
  const rowFor = (kind: string) => totals.find((finding) => finding.id.includes(kind))?.anchor?.rowText;

  it("runs the totals lane and anchors every totals finding", () => {
    expect(totals.length).toBeGreaterThanOrEqual(5);
    for (const finding of totals) expect(finding.anchor, finding.id).toBeDefined();
  });

  it("never anchors a totals finding on the TOTALS SUMMARY block", () => {
    for (const finding of totals) expect(finding.anchor.section, `${finding.id} -> ${finding.anchor.rowText}`).not.toBe(TOTALS_SUMMARY_SECTION);
  });

  it("puts each category finding on the ESTIMATE TOTALS row it was computed from", () => {
    expect(rowFor("rate-difference-body-labor")).toBe("Body Labor 34.7 hrs @ $ 100.00 /hr 3,470.00");
    expect(rowFor("rate-difference-paint-labor")).toBe("Paint Labor 15.4 hrs @ $ 100.00 /hr 1,540.00");
    expect(rowFor("hours-difference-paint-supplies")).toBe("Paint Supplies 15.4 hrs @ $ 41.00 /hr 631.40");
  });

  // The supplement's own line items and their SUBTOTALS rule print AFTER
  // ESTIMATE TOTALS (page 7), so a search by document order alone put the
  // lower-only listing on "SUBTOTALS 314.35 8.3 3.6" and the grand-total gap
  // on the cumulative-effects table (page 8).
  it("keeps the lower-only listing and the grand total on the ESTIMATE TOTALS block", () => {
    expect(rowFor("lower-only-lines")).toBe("Total Cost of Repairs 11,618.63");
    expect(rowFor("total-difference-grand-total")).toBe("Net Cost of Repairs 11,618.63");
  });

  it("anchors every totals finding inside the measured ESTIMATE TOTALS block", () => {
    for (const finding of totals) {
      expect([finding.anchor.pageNumber, finding.anchor.totalsBlock], `${finding.id} -> ${finding.anchor.rowText}`).toEqual([6, "estimate totals"]);
    }
  });
});

describe("createTotalsAnchorClaimer", () => {
  /** Only the fields the claimer reads. */
  const anchor = (anchorId: string, pageNumber: number, rowText: string, totalsBlock?: "estimate totals"): EstimateRowAnchor =>
    ({ anchorId, pageNumber, rowText, sourceDocumentId: "sor", anchorType: "totals_row", ...(totalsBlock ? { totalsBlock } : {}) }) as EstimateRowAnchor;
  // A supplement print: ESTIMATE TOTALS on page 6, then the supplement's own
  // line items closing with their SUBTOTALS rule on page 7.
  const anchors = [
    anchor("title", 6, "ESTIMATE TOTALS", "estimate totals"),
    anchor("parts", 6, "Parts 3,769.07", "estimate totals"),
    anchor("subtotal", 6, "Subtotal 10,960.97", "estimate totals"),
    anchor("grand", 6, "Total Cost of Repairs 11,618.63", "estimate totals"),
    anchor("rule", 7, "SUBTOTALS 314.35 8.3 3.6"),
  ];
  const subtotal = (text: string) => /subtotal/.test(text);

  it("takes a free row in the measured block over a later row outside it", () => {
    expect(createTotalsAnchorClaimer(anchors, new Set())(subtotal)?.anchorId).toBe("subtotal");
  });

  it("reuses a claimed row in the block before taking a free row outside it", () => {
    expect(createTotalsAnchorClaimer(anchors, new Set(["subtotal"]))(subtotal)?.anchorId).toBe("subtotal");
  });

  it("prefers a free row to a claimed one inside the block", () => {
    const totals = (text: string) => /subtotal|total cost of repair/.test(text);
    expect(createTotalsAnchorClaimer(anchors, new Set(["grand"]))(totals)?.anchorId).toBe("subtotal");
  });

  it("falls back to rows outside the block when nothing in it matches", () => {
    expect(createTotalsAnchorClaimer(anchors, new Set())((text) => /^subtotals /.test(text))?.anchorId).toBe("rule");
  });

  it("searches from the end when no block was measured (stored text, Mitchell)", () => {
    const unmeasured = anchors.map((measured) => ({ ...measured, totalsBlock: undefined }));
    expect(createTotalsAnchorClaimer(unmeasured, new Set())(subtotal)?.anchorId).toBe("rule");
  });
});

