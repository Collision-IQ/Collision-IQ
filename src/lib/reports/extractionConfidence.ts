/**
 * Extraction confidence, DERIVED — never asserted.
 *
 * A confidence scalar with no defined formula is what already shipped:
 * "Adjusted confidence: High" on a run with 25 rule violations, and "68%"
 * attached to a forum thread cited as an OEM authority. If the thing that
 * opens or closes a gate is an emitted opinion, the gate is only as good as
 * whatever emitted it.
 *
 * So this is a pure function of observables the pipeline already measures, and
 * it returns those inputs alongside the score. Anything that cannot be
 * recomputed from named observables must not be allowed to gate.
 *
 * WHAT THE CORPUS TAUGHT ABOUT THE SECTION TERM. Sections of the annotated
 * estimate with no counterpart rows look like an extraction failure and
 * usually are not: RO 22182's carrier EOR has 8 sections against the shop's
 * 17 — 11 with zero counterpart rows — while its hours coverage is 93%. The
 * carrier simply wrote a smaller document. So the section ratio only carries
 * weight once a coverage signal already says the read was incomplete; on its
 * own it would condemn a correctly-parsed estimate for being shorter than the
 * one it is compared against.
 */

export interface ExtractionObservables {
  /** Parsed rows / rows implied by the line-number span (C-10). */
  lineSpanCoverage: number;
  /** Parsed hours / hours the document's own totals block prints. */
  hoursCoverage: number;
  /** M-1: false only when a font is non-embedded AND carries no ToUnicode map. */
  textLayerReliable: boolean;
  /** True when the text came from OCR rather than a native text layer. */
  ocrDerived: boolean;
  sectionsWithZeroCounterpartRows: number;
  totalSections: number;
  /**
   * Did the document print an ESTIMATE TOTALS block?
   *
   * The one signal that survives a TAIL TRUNCATION, which both coverage
   * measures are blind to: cut an estimate short and the surviving rows are a
   * contiguous run (line-span reads high) while the totals block disappears
   * with the tail (hours coverage loses its denominator and defaults to 1.0).
   * All eight corpus estimates print the block, so its absence means the read
   * stopped early — not that the document is small.
   *
   * Optional so existing callers keep their behaviour; undefined is treated as
   * present, since a caller that cannot tell must not manufacture doubt.
   */
  totalsBlockFound?: boolean;
}

export type ConfidenceBand = "high" | "medium" | "low";

export interface DerivedExtractionConfidence {
  score: number;
  band: ConfidenceBand;
  /** Every input, so a reader can recompute the score from the record. */
  inputs: ExtractionObservables & { sectionAbsenceRatio: number };
  /** One line naming the inputs, for the artifact itself. */
  explanation: string;
}

/** Coverage below this reads as an incomplete extraction rather than a short
 *  document. Correctly-read corpus documents measure 0.72-0.95. */
const COVERAGE_FLOOR = 0.5;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Confidence as a function of coverage, text-layer integrity, and — only when
 * coverage is already weak — how much of the document produced no rows.
 */
export function deriveExtractionConfidence(
  observables: ExtractionObservables
): DerivedExtractionConfidence {
  const {
    lineSpanCoverage,
    hoursCoverage,
    textLayerReliable,
    ocrDerived,
    sectionsWithZeroCounterpartRows,
    totalSections,
  } = observables;

  const sectionAbsenceRatio =
    totalSections > 0 ? sectionsWithZeroCounterpartRows / totalSections : 0;

  // The weaker of the two independent coverage measures leads: they fail in
  // different ways, and a document is only as well read as its worst signal.
  const coverage = clamp01(Math.min(lineSpanCoverage, hoursCoverage));
  let score = coverage;

  // A document with no totals block was not read to its end. Both coverage
  // measures report a truncated estimate as well-read, so this is the only
  // signal that catches it, and it caps rather than scales: the coverage
  // numbers it overrides are not evidence of anything.
  if (observables.totalsBlockFound === false) score = Math.min(score, 0.4);
  // A text layer that cannot be trusted caps the result regardless of coverage
  // — rows may have parsed cleanly out of mis-mapped glyphs.
  if (!textLayerReliable) score = Math.min(score, 0.45);
  // OCR is a real read, but never a confident one.
  if (ocrDerived) score = Math.min(score, 0.7);

  // Only once coverage is already suspect does an empty-section ratio mean
  // anything; see the note above about RO 22182.
  if (coverage < COVERAGE_FLOOR) {
    score = clamp01(score * (1 - sectionAbsenceRatio));
  }

  const band: ConfidenceBand = score >= 0.75 ? "high" : score >= 0.5 ? "medium" : "low";

  return {
    score: Math.round(score * 100) / 100,
    band,
    inputs: { ...observables, sectionAbsenceRatio: Math.round(sectionAbsenceRatio * 100) / 100 },
    explanation:
      `extraction confidence ${Math.round(score * 100)}% (${band}) — ` +
      `line-span coverage ${Math.round(lineSpanCoverage * 100)}%, ` +
      `hours coverage ${Math.round(hoursCoverage * 100)}%, ` +
      `text layer ${textLayerReliable ? "reliable" : "UNRELIABLE"}` +
      `${ocrDerived ? ", OCR-derived" : ""}` +
      `${observables.totalsBlockFound === false ? ", NO TOTALS BLOCK (read stopped early)" : ""}, ` +
      `${sectionsWithZeroCounterpartRows} of ${totalSections} sections with no counterpart rows`,
  };
}

/**
 * May a section carry confident ABSENCE findings?
 *
 * A section of the counterpart that produced no rows cannot support the claim
 * that the counterpart omitted the work — unless the document as a whole was
 * read well, in which case an empty section is a real absence. This is the
 * section-level half of the gate: it quarantines the rear-lamps section while
 * the quarter panel still compares, instead of blocking a claim that was 90%
 * readable.
 */
export function sectionSupportsAbsenceClaims(params: {
  counterpartRowsInSection: number;
  documentConfidence: DerivedExtractionConfidence;
}): boolean {
  if (params.counterpartRowsInSection > 0) return true;
  // Zero counterpart rows in this section: trust it only if the document as a
  // whole read well enough that the emptiness is informative.
  return params.documentConfidence.band === "high";
}
