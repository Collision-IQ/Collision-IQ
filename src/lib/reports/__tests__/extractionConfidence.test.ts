/**
 * Extraction confidence is DERIVED, and the section gate is CONDITIONED on it.
 *
 * A confidence scalar with no formula is what already shipped: "Adjusted
 * confidence: High" on a run with 25 rule violations, and "68%" attached to a
 * forum thread cited as an OEM authority. If the value that opens a gate is an
 * emitted opinion, the gate is only as good as whatever emitted it. So the
 * score is a pure function of named observables and returns them with it.
 *
 * THE MEASUREMENT THAT SHAPED THE SECTION TERM. Sections of the annotated
 * estimate with no counterpart rows look like extraction failure and usually
 * are not: RO 22182's carrier EOR has 8 sections against the shop's 17 — 11
 * with zero counterpart rows — at 93% hours coverage. The carrier wrote a
 * smaller document. Quarantining on emptiness alone would have deleted 65 of
 * that run's 74 absence findings, so the section ratio only carries weight
 * once coverage already says the read was incomplete.
 */
import { describe, it, expect } from "vitest";
import { deriveExtractionConfidence, sectionSupportsAbsenceClaims } from "../extractionConfidence";

const base = {
  lineSpanCoverage: 0.9,
  hoursCoverage: 0.93,
  textLayerReliable: true,
  ocrDerived: false,
  sectionsWithZeroCounterpartRows: 1,
  totalSections: 18,
};

describe("the score is recomputable from its inputs", () => {
  it("returns every observable it used", () => {
    const result = deriveExtractionConfidence(base);
    expect(result.inputs).toMatchObject(base);
    expect(result.inputs.sectionAbsenceRatio).toBeCloseTo(1 / 18, 2);
  });

  it("names the inputs in the line a reader sees", () => {
    const { explanation } = deriveExtractionConfidence(base);
    expect(explanation).toMatch(/line-span coverage 90%/);
    expect(explanation).toMatch(/hours coverage 93%/);
    expect(explanation).toMatch(/text layer reliable/);
    expect(explanation).toMatch(/1 of 18 sections with no counterpart rows/);
  });

  it("leads with the weaker of the two coverage measures", () => {
    // They fail differently; a document is only as well read as its worst signal.
    const weakHours = deriveExtractionConfidence({ ...base, hoursCoverage: 0.34 });
    expect(weakHours.score).toBeLessThanOrEqual(0.34);
    expect(weakHours.band).toBe("low");
  });
});

describe("the corpus reads high, the degraded cases read low", () => {
  it("passes every correctly-read corpus document", () => {
    // Measured: 22047 78/100, 22059 85/89, 22182 81/93, 22116 90/95.
    for (const [span, hours] of [[0.78, 1.0], [0.85, 0.89], [0.81, 0.93], [0.9, 0.95]]) {
      const result = deriveExtractionConfidence({ ...base, lineSpanCoverage: span, hoursCoverage: hours });
      expect(result.band).toBe("high");
    }
  });

  it("an unreliable text layer caps confidence however good coverage looks", () => {
    const result = deriveExtractionConfidence({ ...base, textLayerReliable: false });
    expect(result.score).toBeLessThanOrEqual(0.45);
    expect(result.band).toBe("low");
  });

  it("OCR is a real read but never a confident one", () => {
    const result = deriveExtractionConfidence({ ...base, ocrDerived: true });
    expect(result.score).toBeLessThanOrEqual(0.7);
    expect(result.band).not.toBe("high");
  });

  it("empty sections only count against a document already reading badly", () => {
    // RO 22182: 11 of 17 sections empty, but coverage is high — unpunished.
    const wellRead = deriveExtractionConfidence({
      ...base,
      lineSpanCoverage: 0.81,
      hoursCoverage: 0.93,
      sectionsWithZeroCounterpartRows: 11,
      totalSections: 17,
    });
    expect(wellRead.band).toBe("high");

    // Same section ratio, but the read was poor: now it compounds.
    const poorlyRead = deriveExtractionConfidence({
      ...base,
      lineSpanCoverage: 0.4,
      hoursCoverage: 0.34,
      sectionsWithZeroCounterpartRows: 11,
      totalSections: 17,
    });
    expect(poorlyRead.score).toBeLessThan(0.2);
  });
});

describe("the section gate quarantines a section, not the claim", () => {
  const high = deriveExtractionConfidence(base);
  const low = deriveExtractionConfidence({ ...base, hoursCoverage: 0.3, lineSpanCoverage: 0.3 });

  it("permits absence claims wherever the counterpart produced rows", () => {
    expect(sectionSupportsAbsenceClaims({ counterpartRowsInSection: 4, documentConfidence: low })).toBe(true);
  });

  it("permits an empty section when the document read well", () => {
    // The carrier genuinely did not write it.
    expect(sectionSupportsAbsenceClaims({ counterpartRowsInSection: 0, documentConfidence: high })).toBe(true);
  });

  it("refuses an empty section when the document read badly", () => {
    // A section this pass could not read is not a section the carrier omitted.
    expect(sectionSupportsAbsenceClaims({ counterpartRowsInSection: 0, documentConfidence: low })).toBe(false);
  });
});
