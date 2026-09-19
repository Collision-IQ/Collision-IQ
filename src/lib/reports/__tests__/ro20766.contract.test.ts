/**
 * RO 20766 CONTRACT — 2018 Tesla Model 3, shop Preliminary Estimate (CCC ONE,
 * $10,437.31) against USAA Supplement of Record 3 (CCC ONE, $7,781.92 gross /
 * $7,281.92 net of a $500.00 deductible). Same VIN, same claim, both with
 * clean positioned text layers.
 *
 * The run refused with "R24 target grand_total unresolved — a run that read
 * neither totals block cannot ship" on BOTH sides, although the text lane
 * read both ESTIMATE TOTALS blocks to the cent. Two defects, one refusal:
 *
 * D1 — the shop bills its calibration operations to a user-defined CCC labor
 *      class ("3"). On rows with no hours the class digit prints ALONE in the
 *      labor column, and the typed engine read it as 3.0 h — twelve times —
 *      putting the extract 36.0 h over its own printed SUBTOTALS (28.0).
 * D2 — the SUBTOTALS reconciliation guard then returned null for the WHOLE
 *      match, totals summaries included, so the release bundle carried no
 *      grand total and the gate blamed a totals reader that had not failed.
 *
 * Fixtures are the real word layers and text of both documents with the
 * natural-person identifiers redacted (owner, VIN last eight, plate, claim,
 * addresses, phones, e-mails); every operation row, value and total is as
 * printed.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import { buildPdfTextLines, buildEstimateRowAnchorsFromLines, type PdfWord } from "../citationDensityRowAnchors";
import {
  buildProductionReleaseBundle,
  buildRequiredEstimatorDeltaFindings,
  pdfWordsToEnginePages,
} from "../annotatedCitationDensityEstimate";
import { emptyRowParseDiagnostics, parseEstimateRows, parseGrandTotalFromWords, parseSubtotalsFromWords } from "../deltaEngine/rowCluster";
import { mayRelease, runDeltaReleaseGate } from "../deltaReleaseGate";

const FIXTURE_DIR = path.join(__dirname, "../../../../tests/fixtures/20766");
const read = (name: string) => fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8");
const shopText = read("shop_text.txt");
const sorText = read("sor3_text.txt");
const shopWords = JSON.parse(read("shop_words.json")) as PdfWord[];
const sorWords = JSON.parse(read("sor3_words.json")) as PdfWord[];

const sum = (values: Array<number | null>) => Math.round(values.reduce<number>((total, value) => total + (value ?? 0), 0) * 10) / 10;

/** The rows that print the class digit "3" with NO hours (calibration
 *  operations billed to the shop's Calibration/Reset category). */
const CLASS_ONLY_LINES = [75, 76, 77, 78, 80, 81, 82, 83, 84, 86, 87, 88];
/** The rows that print 1.0 h followed by the class digit "3". */
const CLASS_WITH_HOURS_LINES = [74, 79, 85];

function generate(words: PdfWord[], warnings: string[]) {
  const visualLines = buildPdfTextLines(words);
  const anchors = buildEstimateRowAnchorsFromLines(visualLines, { sourceDocumentRole: "shop", sourceDocumentId: "shop-20766" });
  return buildRequiredEstimatorDeltaFindings({
    anchors,
    visualLines,
    sourcePdfName: "Shop 20766.pdf",
    sourceDocumentId: "shop-20766",
    sourceDocumentRole: "shop",
    sourcePdfHash: "fixture-20766-shop",
    uploadedFileNames: ["Shop 20766.pdf", "SOR3.pdf"],
    sourceText: shopText,
    comparisonEstimateTexts: [{ sourceDocumentId: "sor-20766", fileName: "SOR3.pdf", text: sorText, estimateRole: "carrier" }],
    comparisonEstimateWords: [{ fileName: "SOR3.pdf", estimateRole: "carrier", words: sorWords, textLayerReliable: true }],
    extractionWarnings: warnings,
  });
}

function gate(generated: ReturnType<typeof buildRequiredEstimatorDeltaFindings>) {
  const bundle = buildProductionReleaseBundle({
    sourcePdfName: "Shop 20766.pdf",
    sourceText: shopText,
    comparison: { fileName: "SOR3.pdf", text: sorText },
    findings: generated.findings,
    reconciliation: generated.forensic?.reconciliation ?? null,
    intakeModeActive: generated.debug?.intakeModeActive === true,
    unanchoredAppendixRendered: true,
    retrievedSources: [],
    lineCounts: {
      target: generated.forensic?.higherLineCount ?? null,
      source: generated.forensic?.lowerLineCount ?? null,
    },
  });
  return { bundle, violations: runDeltaReleaseGate(bundle) };
}

describe("D1 — a bare labor-class digit in the hours column is a class, never hours", () => {
  const rows = parseEstimateRows(pdfWordsToEnginePages(shopWords), emptyRowParseDiagnostics());
  const byLine = new Map(rows.map((row) => [row.line, row]));

  it("reads every operation row on the shop estimate", () => {
    expect(rows.length).toBeGreaterThanOrEqual(80);
  });

  it("types the twelve class-only calibration rows as no hours, class 3", () => {
    for (const line of CLASS_ONLY_LINES) {
      const row = byLine.get(line);
      expect(row, `line ${line}`).toBeDefined();
      expect(row?.labor, `line ${line} labor`).toBeNull();
      expect(row?.paint, `line ${line} paint`).toBeNull();
      expect(row?.laborClass, `line ${line} class`).toBe("3");
    }
  });

  it("keeps the hours on the three scan rows that print 1.0 h beside the class digit", () => {
    for (const line of CLASS_WITH_HOURS_LINES) {
      const row = byLine.get(line);
      expect(row?.labor, `line ${line} labor`).toBe(1);
      expect(row?.laborClass, `line ${line} class`).toBe("3");
    }
  });

  it("reconciles both typed extracts to their documents' own printed SUBTOTALS", () => {
    const shopPrinted = parseSubtotalsFromWords(pdfWordsToEnginePages(shopWords));
    expect(shopPrinted).toMatchObject({ labor: 28, paint: 17.9 });
    const shopBody = rows.filter((row) => row.page <= (shopPrinted?.page ?? Infinity));
    expect(sum(shopBody.map((row) => row.labor))).toBe(28);
    expect(sum(shopBody.map((row) => row.paint))).toBe(17.9);

    const sorRows = parseEstimateRows(pdfWordsToEnginePages(sorWords), emptyRowParseDiagnostics());
    const sorPrinted = parseSubtotalsFromWords(pdfWordsToEnginePages(sorWords));
    expect(sorPrinted).toMatchObject({ labor: 19.5, paint: 10.7 });
    const sorBody = sorRows.filter((row) => row.page <= (sorPrinted?.page ?? Infinity));
    expect(sum(sorBody.map((row) => row.labor))).toBe(19.5);
    expect(sum(sorBody.map((row) => row.paint))).toBe(10.7);
  });

  it("resolves both grand totals from the word layer", () => {
    expect(parseGrandTotalFromWords(pdfWordsToEnginePages(shopWords))).toMatchObject({ value: 10437.31 });
    expect(parseGrandTotalFromWords(pdfWordsToEnginePages(sorWords))).toMatchObject({ value: 7781.92 });
  });
});

describe("the pair runs FULL and clears the release gate", () => {
  let generated: ReturnType<typeof buildRequiredEstimatorDeltaFindings>;
  const warnings: string[] = [];

  beforeAll(() => {
    generated = generate(shopWords, warnings);
  });

  it("does not withhold the line-item comparison and does not fall to intake", () => {
    expect(warnings.some((warning) => /withheld/i.test(warning))).toBe(false);
    expect(generated.debug?.intakeModeActive).not.toBe(true);
    expect(generated.forensic?.lineItemComparisonWithheld ?? null).toBeNull();
    expect(generated.forensic?.higherLineCount).toBeGreaterThanOrEqual(75);
    expect(generated.forensic?.lowerLineCount).toBeGreaterThanOrEqual(45);
  });

  it("reconciles both totals blocks and states the 2,655.39 gap", () => {
    const reconciliation = generated.forensic!.reconciliation;
    expect(reconciliation.higherGrandTotal).toBe(10437.31);
    expect(reconciliation.lowerGrandTotal).toBe(7781.92);
    expect(reconciliation.grandTotalDifference).toBe(-2655.39);
  });

  it("ships: no R24 violation", () => {
    const { violations } = gate(generated);
    expect(violations.map((violation) => `${violation.rule} ${violation.message}`)).toEqual([]);
    expect(mayRelease(violations)).toBe(true);
  });
});

describe("D2 — a withheld line-item comparison keeps the totals blocks", () => {
  let generated: ReturnType<typeof buildRequiredEstimatorDeltaFindings>;
  const warnings: string[] = [];

  beforeAll(() => {
    // Corrupt ONE typed labor cell on the annotated side (line 6, "O/H front
    // bumper", 2.9 h → 9.9 h) so its extract no longer reconciles to the
    // printed SUBTOTALS and the guard withholds the line-item comparison.
    let corrupted = false;
    const perturbed = shopWords.map((word) => {
      if (!corrupted && word.pageNumber === 2 && word.text === "2.9") {
        corrupted = true;
        return { ...word, text: "9.9", normalizedText: "9.9" };
      }
      return word;
    });
    expect(corrupted).toBe(true);
    generated = generate(perturbed, warnings);
  });

  it("says so, on the run and on the forensic input", () => {
    expect(warnings.some((warning) => /Line-item comparison was withheld/.test(warning))).toBe(true);
    expect(generated.forensic?.lineItemComparisonWithheld).toMatch(/withheld/);
  });

  it("asserts nothing at line level", () => {
    expect(generated.debug?.lineItemDeltaMatchedPairCount).toBe(0);
    expect(generated.debug?.lineItemDeltaMissingCount).toBe(0);
    expect(generated.forensic?.noCounterpartRows).toEqual([]);
    expect(generated.debug?.intakeModeActive).not.toBe(true);
  });

  it("still resolves BOTH grand totals — the refusal that blamed the totals reader is gone", () => {
    const reconciliation = generated.forensic!.reconciliation;
    expect(reconciliation.higherGrandTotal).toBe(10437.31);
    expect(reconciliation.lowerGrandTotal).toBe(7781.92);
    const { bundle, violations } = gate(generated);
    expect(bundle.target?.grand_total).toBe(10437.31);
    expect(bundle.source?.grand_total).toBe(7781.92);
    expect(violations.filter((violation) => /grand_total unresolved/.test(violation.message))).toEqual([]);
    // Totals-level findings are category-scoped evidence on their own.
    expect(generated.findings.filter((finding) => finding.id.startsWith("required-detector-totals-")).length).toBeGreaterThanOrEqual(3);
    expect(mayRelease(violations)).toBe(true);
  });
});
