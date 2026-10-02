/**
 * The text lane's rows of the annotated estimate reproduce its printed hours.
 *
 * When the comparison estimate has no usable word layer (or is Mitchell, which
 * skips the typed lane), the annotated estimate's rows come from the text
 * lane: row anchors re-read as text, with the positions of their words
 * dropped. Measured on two CCC ONE shop estimates (2 Oct 2026), those rows did
 * not reproduce the printed hours while the typed-cell rows of the same prints
 * closed to the tenth:
 *
 *   RO 20766 shop: 33.1 labor / 7.3 paint hr against 28.0 / 17.9 printed,
 *                  83 rows against 85;
 *   RO 22084 shop: 61.2 / 10.9 against 56.9 / 19.2, 141 rows against 145.
 *
 * Row by row, three defects explained every tenth:
 *
 *   1. A lone hour value has no column in text and read as labor:
 *      "Add for Clear Coat 1.2", "Refn Tow brkt cover 0.2", "Blnd Hood (ALU)
 *      2.6", "Tint color 1 0.5", "Overlap Minor Panel -0.2" are paint
 *      (20766: 10.6 hr moved; 22084: 8.3 hr).
 *   2. A labor-class digit printed after the hours read as a quantity and the
 *      hours were lost: "Test fit-Front bumper 1 1.0 1", "Rpr Pre repair scan
 *      1.0 3" (20766: 5.5 hr).
 *   3. Whole lines were lost: wrapped tails the text rules cannot move ahead
 *      of the value columns ("… frame bench 1 2.0 (Unibody)", "… cutting, 1
 *      Incl. T 1.0 grinding & welding", "** Secured****"), and a "Work
 *      Authorization" line the anchor builder skips as boilerplate (22084:
 *      4.0 hr).
 *
 * The Appraisal Dispute Report adapter refuses any sheet whose line hours do
 * not reproduce its printed hours (lineHoursRead, hoursReconcile), so every
 * such run shipped no dispute report, while the forensic report and the
 * annotated estimate used the misread rows. The text lane now takes the cells
 * text cannot place from the measured word layer when that read closes the
 * print's own SUBTOTALS, and never otherwise.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildPdfTextLines, buildEstimateRowAnchorsFromLines, type EstimateRowAnchor, type PdfWord } from "../citationDensityRowAnchors";
import { buildRequiredEstimatorDeltaFindings, pdfWordsToEnginePages } from "../annotatedCitationDensityEstimate";
import { hoursReconcile, parseEstimateRows, parseSubtotalsFromWords } from "../deltaEngine/rowCluster";
import { estimateFromDeltaRows, lineHoursRead, totalsFromReconciliation } from "../appraisalSummary/estimateFromDeltaRows";
import type { EstimateDeltaRow } from "../estimateDeltaMatcher";

const FIXTURES = [
  { ro: "20766", comparison: "sor3", printed: { labor: 28, paint: 17.9 } },
  { ro: "22084", comparison: "sor5", printed: { labor: 56.9, paint: 19.2 } },
] as const;

const load = (ro: string, name: string) =>
  fs.readFileSync(path.join(__dirname, "../../../../tests/fixtures", ro, name), "utf8");

const sum = (values: Array<number | null>) =>
  Math.round(values.reduce<number>((total, value) => total + (value ?? 0), 0) * 10) / 10;

/** The pipeline's text lane: the comparison arrives as text with no word layer. */
function runTextLane(ro: string, comparison: string, words: PdfWord[]) {
  const visualLines = buildPdfTextLines(words);
  const anchors = buildEstimateRowAnchorsFromLines(visualLines, { sourceDocumentRole: "shop", sourceDocumentId: `shop-${ro}` });
  const generated = buildRequiredEstimatorDeltaFindings({
    anchors,
    visualLines,
    sourcePdfName: `Shop ${ro}.pdf`,
    sourceDocumentId: `shop-${ro}`,
    sourceDocumentRole: "shop",
    sourcePdfHash: `fixture-${ro}-shop`,
    uploadedFileNames: [`Shop ${ro}.pdf`, `${comparison}.pdf`],
    sourceText: load(ro, "shop_text.txt"),
    comparisonEstimateTexts: [
      { sourceDocumentId: `${comparison}-${ro}`, fileName: `${comparison}.pdf`, text: load(ro, `${comparison}_text.txt`), estimateRole: "carrier" },
    ],
    comparisonEstimateWords: [],
    extractionWarnings: [],
  });
  return { generated, anchors };
}

function rowsOf(generated: ReturnType<typeof buildRequiredEstimatorDeltaFindings>): EstimateDeltaRow[] {
  return generated.forensic!.rows.higher;
}

const lineOf = (rows: EstimateDeltaRow[], line: number) => rows.find((row) => row.lineNumber === line);

describe.each(FIXTURES)("RO $ro shop estimate, comparison read as text", ({ ro, comparison, printed }) => {
  const words = JSON.parse(load(ro, "shop_words.json")) as PdfWord[];
  let rows: EstimateDeltaRow[];
  let anchors: EstimateRowAnchor[];
  let generated: ReturnType<typeof buildRequiredEstimatorDeltaFindings>;

  beforeAll(() => {
    ({ generated, anchors } = runTextLane(ro, comparison, words));
    rows = rowsOf(generated);
  });

  it("runs the text lane: no line-item comparison withheld, rows read", () => {
    expect(generated.forensic?.lineItemComparisonWithheld ?? null).toBeNull();
    expect(rows.length).toBeGreaterThan(0);
  });

  it("its line hours reproduce the printed SUBTOTALS labor and paint hours", () => {
    expect(parseSubtotalsFromWords(pdfWordsToEnginePages(words))).toMatchObject(printed);
    const labor = sum(rows.map((row) => row.labor));
    const paint = sum(rows.map((row) => row.paint));
    expect(hoursReconcile(labor, printed.labor), `labor ${labor} vs ${printed.labor}`).toBe(true);
    expect(hoursReconcile(paint, printed.paint), `paint ${paint} vs ${printed.paint}`).toBe(true);
  });

  it("passes the Appraisal Dispute Report's line-hours check against the printed ESTIMATE TOTALS", () => {
    const totals = totalsFromReconciliation(generated.forensic!.reconciliation, "higher");
    if (!totals.ok) throw new Error(totals.reason);
    const read = lineHoursRead(
      estimateFromDeltaRows({
        role: "shop",
        fileName: `Shop ${ro}.pdf`,
        rows,
        totals: totals.totals,
        userCategory: totals.userCategory,
        userCategories: totals.userCategories,
        text: load(ro, "shop_text.txt"),
      })
    );
    expect(read.closes, JSON.stringify(read)).toBe(true);
  });

  it("reads every printed line the measured word layer reads, once, in print order", () => {
    const measured = [...new Set(parseEstimateRows(pdfWordsToEnginePages(words)).map((row) => row.line))];
    const read = rows.map((row) => row.lineNumber).filter((line): line is number => line !== null);
    expect(measured.filter((line) => !read.includes(line))).toEqual([]);
    expect(new Set(read).size).toBe(read.length);
    expect(read).toEqual([...read].sort((a, b) => a - b));
  });

  it("anchors every row to an anchor the renderer can resolve", () => {
    const anchorIds = new Set(anchors.map((anchor) => anchor.anchorId));
    expect(rows.filter((row) => !row.anchorId || !anchorIds.has(row.anchorId)).map((row) => row.lineNumber)).toEqual([]);
  });
});

describe("RO 20766: the cells text cannot place come from the measured columns", () => {
  const words = JSON.parse(load("20766", "shop_words.json")) as PdfWord[];
  let rows: EstimateDeltaRow[];

  beforeAll(() => {
    rows = rowsOf(runTextLane("20766", "sor3", words).generated);
  });

  it("a lone refinish hour is paint, not labor", () => {
    for (const [line, paint] of [[8, 1.2], [12, 0.2], [30, 2.6], [52, 2], [94, 0.5]] as const) {
      expect(lineOf(rows, line), `line ${line}`).toMatchObject({ labor: null, paint });
    }
  });

  it("a labor-class digit after the hours is the class, and the hours stay", () => {
    expect(lineOf(rows, 21)).toMatchObject({ qty: 1, labor: 1, laborType: "1" });
    for (const line of [74, 79, 85]) {
      expect(lineOf(rows, line), `line ${line}`).toMatchObject({ qty: null, labor: 1, laborType: "3" });
    }
    // The class digit alone, no hours: no quantity, no hours.
    expect(lineOf(rows, 75)).toMatchObject({ qty: null, labor: null, paint: null, laborType: null });
  });

  it("keeps the text read's own identity: operation, description, anchor, printed text", () => {
    expect(lineOf(rows, 8)).toMatchObject({ opCode: "Add", description: "for Clear Coat", anchorId: "shop-20766:p2:8:estimate_line" });
    expect(lineOf(rows, 30)).toMatchObject({ opCode: "Blnd" });
    expect(lineOf(rows, 30)?.rawText).toBe("30 * Blnd Hood (ALU) 2.6");
  });

  it("a measured read that does not close its print never replaces the text read", () => {
    // One labor cell corrupted (line 6, 2.9 h → 9.9 h): the typed rows no
    // longer reproduce the printed SUBTOTALS, so nothing vouches for them.
    let corrupted = false;
    const perturbed = words.map((word) => {
      if (!corrupted && word.pageNumber === 2 && word.text === "2.9") {
        corrupted = true;
        return { ...word, text: "9.9", normalizedText: "9.9" };
      }
      return word;
    });
    expect(corrupted).toBe(true);
    const textRead = rowsOf(runTextLane("20766", "sor3", perturbed).generated);
    expect(lineOf(textRead, 8)).toMatchObject({ labor: 1.2, paint: null });
    expect(lineOf(textRead, 4)).toBeUndefined();
  });

  it("a print with no SUBTOTALS hours vouches for nothing: the text read stands", () => {
    const rule = words.find((word) => word.text === "SUBTOTALS")!;
    const unprinted = words.filter(
      (word) => !(word.pageNumber === rule.pageNumber && Math.abs(word.y - rule.y) <= 3 && /^-?\d+\.\d$/.test(word.text))
    );
    expect(unprinted.length).toBe(words.length - 2);
    const textRead = rowsOf(runTextLane("20766", "sor3", unprinted).generated);
    expect(lineOf(textRead, 8)).toMatchObject({ labor: 1.2, paint: null });
  });
});

describe("RO 22084: printed lines the text rules lose are read from the measured word layer", () => {
  let rows: EstimateDeltaRow[];

  beforeAll(() => {
    const words = JSON.parse(load("22084", "shop_words.json")) as PdfWord[];
    rows = rowsOf(runTextLane("22084", "sor5", words).generated);
  });

  it("recovers the four lines with their hours and no invented price", () => {
    expect(lineOf(rows, 2)).toMatchObject({ labor: 1, paint: null, price: null, qty: 1 });
    expect(lineOf(rows, 4)).toMatchObject({ labor: null, paint: null, price: null, qty: 1 });
    expect(lineOf(rows, 70)).toMatchObject({ description: "Set up vehicle on frame bench (Unibody)", labor: 2, paint: null });
    expect(lineOf(rows, 81)).toMatchObject({ labor: 1, paint: null, laborIncluded: false });
  });

  it("refinish overlap and three-stage add-ons are paint", () => {
    for (const [line, paint] of [[39, 0.1], [53, -0.2], [88, -0.2], [90, 1.2], [124, 2]] as const) {
      expect(lineOf(rows, line), `line ${line}`).toMatchObject({ labor: null, paint });
    }
  });
});
