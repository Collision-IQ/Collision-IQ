/**
 * THE NEGATIVE CORPUS: what the pipeline claims when the counterpart is not
 * readable.
 *
 * Every other fixture in this repo pairs two documents that both parsed. The
 * dangerous case is the one that LOOKS fine: a scanned or partly-recovered
 * carrier estimate yields some rows, the report compares against them, and
 * every line the pass could not read silently becomes "the carrier omitted
 * this." Nothing in that output looks wrong.
 *
 * MEASURED on RO 22059, counterpart truncated to 34% of its rows and supplied
 * as OCR text with no word layer:
 *
 *   fully-read control     98 absence phrases in the artifact
 *   truncated to 34%      216 absence phrases        <- before
 *   truncated to 34%      139 absence phrases, 32 marked unverified   <- after
 *
 * TWO DEFECTS THE NEGATIVE CORPUS EXPOSED, neither visible from unit tests:
 *
 *   The section gate was DEAD CODE. matchEstimateLineItems accepted
 *   absenceAllowedForSection and nothing ever passed it, so the derived
 *   confidence gated nothing in production.
 *
 *   Both coverage measures are BLIND TO TAIL TRUNCATION. Cut an estimate short
 *   and the surviving rows are a contiguous 1..49 run, so line-span reads 94%;
 *   the totals block vanishes with the tail, so hours coverage loses its
 *   denominator and returns 1.0. The truncated document measured 94% and 100%
 *   covered. Only the absence of the ESTIMATE TOTALS block catches it — all
 *   eight corpus estimates print one.
 */
import { describe, it, expect } from "vitest";
import { assessHoursCoverage } from "../estimateDeltaMatcher";
import { deriveExtractionConfidence, sectionSupportsAbsenceClaims } from "../extractionConfidence";

const TOTALS_BLOCK = [
  "ESTIMATE TOTALS",
  "Body Labor52.7 hrs@$ 90.00 /hr4,743.00",
  "Paint Labor29.7 hrs@$ 90.00 /hr2,673.00",
].join("\n");

describe("a document with no totals block was not read to its end", () => {
  it("reports the block missing rather than assuming full coverage", () => {
    const truncated = assessHoursCoverage([{ labor: 40, paint: 0 }], "12 Repl Hood 2.0\n13 R&I Grille 0.4");
    expect(truncated.totalsBlockFound).toBe(false);
    // The old behaviour, preserved: no denominator cannot RAISE the gate,
    // because a parts-only estimate legitimately prints no labor.
    expect(truncated.coverage).toBe(1);
    expect(truncated.gate).toBe(false);
  });

  it("still finds the block on a complete document", () => {
    expect(assessHoursCoverage([{ labor: 82, paint: 0 }], TOTALS_BLOCK).totalsBlockFound).toBe(true);
  });

  it("caps confidence for the truncation both coverage measures miss", () => {
    // The exact shape measured: contiguous surviving rows read 94% line-span,
    // and hours coverage returns 1.0 for want of a denominator.
    const truncated = deriveExtractionConfidence({
      lineSpanCoverage: 0.94,
      hoursCoverage: 1,
      textLayerReliable: true,
      ocrDerived: false,
      totalsBlockFound: false,
      sectionsWithZeroCounterpartRows: 14,
      totalSections: 19,
    });
    expect(truncated.band).toBe("low");
    expect(truncated.score).toBeLessThanOrEqual(0.4);
    expect(truncated.explanation).toMatch(/NO TOTALS BLOCK/);
  });

  it("leaves a complete document alone", () => {
    // The control run: same pair, counterpart fully supplied.
    const control = deriveExtractionConfidence({
      lineSpanCoverage: 0.87,
      hoursCoverage: 0.89,
      textLayerReliable: true,
      ocrDerived: false,
      totalsBlockFound: true,
      sectionsWithZeroCounterpartRows: 5,
      totalSections: 19,
    });
    expect(control.band).toBe("high");
    expect(control.explanation).not.toMatch(/NO TOTALS BLOCK/);
  });

  it("treats an unstated totals signal as present, never as doubt", () => {
    // A caller that cannot tell must not manufacture uncertainty.
    const unstated = deriveExtractionConfidence({
      lineSpanCoverage: 0.9,
      hoursCoverage: 0.93,
      textLayerReliable: true,
      ocrDerived: false,
      sectionsWithZeroCounterpartRows: 1,
      totalSections: 18,
    });
    expect(unstated.band).toBe("high");
  });
});

describe("the section gate reaches the findings lane", () => {
  const truncated = deriveExtractionConfidence({
    lineSpanCoverage: 0.94,
    hoursCoverage: 1,
    textLayerReliable: true,
    ocrDerived: false,
    totalsBlockFound: false,
    sectionsWithZeroCounterpartRows: 14,
    totalSections: 19,
  });

  it("refuses absence claims in the sections the truncation swallowed", () => {
    expect(
      sectionSupportsAbsenceClaims({ counterpartRowsInSection: 0, documentConfidence: truncated })
    ).toBe(false);
  });

  it("still permits them where the counterpart produced rows", () => {
    // Quarantine the unread sections, not the whole comparison: the rows that
    // DID survive are real evidence.
    expect(
      sectionSupportsAbsenceClaims({ counterpartRowsInSection: 6, documentConfidence: truncated })
    ).toBe(true);
  });
});
