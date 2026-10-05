/**
 * The category-gap check counts the comparison's own unmatched lines.
 *
 * RO 22120 (review 2026-10-04): once the shop's rear bumper overhaul was no
 * longer folded into the front one as "2x here vs 1x paid", the body-labor
 * "not present" claims came to 8.7 h against the 6.3 h body gap the totals
 * blocks state, and the check demoted all eleven body-labor omissions
 * (bleed brake, wheelhouse liners, transport, road test...) to verify items.
 * The gap is our lines less theirs: the carrier's own lines with no
 * counterpart on ours carried 3.0 h of body labor (R&I bumper cover 1.7,
 * R&I upper cover 0.8, ...), so every claim can be true. Those lines may
 * still be some of the claimed work under other wording, which the note
 * names; when they cannot account for the excess, the claims are flagged as
 * before. Lines are de-identified.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRequiredEstimatorDeltaFindings } from "../annotatedCitationDensityEstimate";
import { buildEstimateRowAnchorsFromLines, buildPdfTextLines, type PdfWord } from "../citationDensityRowAnchors";
import { reconcileMissingClaimsAgainstTotals, type EstimateDeltaRow, type EstimateLineItemDelta } from "../estimateDeltaMatcher";

const row = (line: number, labor: number, opCode = "Rpr", description = `Operation ${line}`): EstimateDeltaRow => ({
  lineNumber: line,
  opCode,
  description,
  descriptionTokens: description.toLowerCase().split(/\s+/),
  partNumber: null,
  section: "REAR BUMPER",
  qty: null,
  price: null,
  labor,
  laborIncluded: false,
  paint: null,
  paintIncluded: false,
  laborType: null,
  rawText: `${line} ${opCode} ${description}`,
});
const claim = (line: number, labor: number): EstimateLineItemDelta => ({
  kind: "missing_operation",
  lowerRow: null,
  higherRow: row(line, labor),
  matchBasis: "none",
  laborDelta: labor,
  paintDelta: null,
  priceDelta: null,
  summary: `Higher estimate documents "Operation ${line}"; this operation is not present on the lower estimate.`,
  annotate: true,
});
const totals = (bodyHours: number) => ({
  categories: [{ category: "Body Labor", hours: bodyHours, rate: 90, cost: bodyHours * 90 }],
  subtotal: null,
  salesTax: null,
  grandTotal: null,
  taxLanes: [],
});

describe("category gap: the comparison's own unmatched lines are part of the gap", () => {
  it("keeps every claim when their unmatched body hours account for the excess, and names those lines", () => {
    const deltas = [claim(56, 3.7), claim(44, 0.5), claim(36, 1.0), claim(78, 0.5)]; // 5.7 h
    const result = reconcileMissingClaimsAgainstTotals({
      deltas,
      higher: totals(23.2),
      lower: totals(19.5), // gap 3.7 h
      lowerOnlyRows: [row(42, 1.7, "R&I", "R&I bumper cover"), row(38, 0.8, "R&I", "LT Upper cover")], // 2.5 h
    });
    expect(result.flagged).toBe(0);
    for (const delta of deltas) {
      expect(delta.ocrUncertain).toBeUndefined();
      expect(delta.exceedsCategoryGap).toBeUndefined();
    }
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toMatch(/claims checked here total 5\.7 h, above the 3\.7 h gap/);
    expect(result.notes[0]).toMatch(/own lines with no counterpart here carry 2\.5 h of body labor \(L42 R&I R&I bumper cover \(1\.7 h\); L38 R&I LT Upper cover \(0\.8 h\)\)/);
    expect(result.notes[0]).toMatch(/may be some of the claimed work written under other wording/);
  });

  it("still flags every claim when their unmatched lines cannot account for the excess", () => {
    const deltas = [claim(1, 2.0), claim(2, 2.0), claim(3, 2.0)]; // 6.0 h
    const result = reconcileMissingClaimsAgainstTotals({
      deltas,
      higher: totals(20),
      lower: totals(18), // gap 2.0 h
      lowerOnlyRows: [row(9, 1.0)], // 1.0 h: 6.0 > 2.0 + 1.0
    });
    expect(result.flagged).toBe(3);
    for (const delta of deltas) expect(delta.ocrUncertain).toBe(true);
  });

  it("counts only the lane's own hours: their mechanical lines do not cover a body-labor excess", () => {
    const mech = { ...row(9, 3.0), laborType: "M" };
    const deltas = [claim(1, 2.0), claim(2, 2.0)];
    const result = reconcileMissingClaimsAgainstTotals({ deltas, higher: totals(20), lower: totals(19), lowerOnlyRows: [mech] });
    expect(result.flagged).toBe(2);
  });
});

describe("the forensic report carries the checks that qualify a claim, not heuristic resemblances", () => {
  it("passes inclusion-note and gap checks to the report; never a 'closely resembles' guess or the net-total target note", () => {
    const dir = path.join(__dirname, "../../../../tests/fixtures/22084");
    const read = (name: string) => fs.readFileSync(path.join(dir, name), "utf8");
    const visualLines = buildPdfTextLines(JSON.parse(read("shop_words.json")) as PdfWord[]);
    const generated = buildRequiredEstimatorDeltaFindings({
      anchors: buildEstimateRowAnchorsFromLines(visualLines, { sourceDocumentRole: "shop", sourceDocumentId: "shop" }),
      visualLines,
      sourcePdfName: "Shop.pdf",
      sourceDocumentId: "shop",
      sourceDocumentRole: "shop",
      sourcePdfHash: "fixture",
      uploadedFileNames: ["Shop.pdf", "SOR.pdf"],
      sourceText: read("shop_text.txt"),
      comparisonEstimateTexts: [{ sourceDocumentId: "sor", fileName: "SOR.pdf", text: read("sor5_text.txt"), estimateRole: "carrier" }],
      comparisonEstimateWords: [
        { fileName: "SOR.pdf", estimateRole: "carrier", words: JSON.parse(read("sor5_words.json")) as PdfWord[], textLayerReliable: true },
      ],
      extractionWarnings: [],
    });
    const notes = generated.forensic?.checkNotes ?? [];
    expect(notes.some((note) => /Tool Box" on SOR\.pdf states it includes/.test(note))).toBe(true);
    expect(notes.filter((note) => /closely resembles|^Target \(annotated document\)|extraction confidence/i.test(note))).toEqual([]);
  });
});
