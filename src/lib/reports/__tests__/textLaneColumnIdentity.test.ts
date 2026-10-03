/**
 * Our sheet's columns when the typed lane cannot run.
 *
 * The typed-cell lane reads each hours value's column by its position, but it
 * needs a word layer on BOTH sides. An image-only SOR (RO 22279's SOR-1 is a
 * scan read by OCR) or a Mitchell comparison leaves our rows to the text
 * lane, which reads a row's lone hours as labor. RO 22279's shop final then
 * read 21.1 labor / 4.3 paint hours against 17.6 / 7.8 printed (its "Add for
 * Clear Coat 0.9", "Tint color 0.5" and "Prep unprimed bumper 0.7" rows sit
 * in the paint column), and the Appraisal Dispute Report refused because its
 * line hours did not reproduce the printed hours.
 *
 * When our own print's typed cells reconcile to its printed SUBTOTALS, a text
 * row whose hours they match in total takes their column split. Its values
 * never change. Measured here on RO 20766's real shop word layer, against a
 * comparison with no word layer.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildEstimateRowAnchorsFromLines, buildPdfTextLines, type PdfWord } from "../citationDensityRowAnchors";
import { buildRequiredEstimatorDeltaFindings, pdfWordsToEnginePages } from "../annotatedCitationDensityEstimate";
import { emptyRowParseDiagnostics, parseEstimateRows, parseSubtotalsFromWords } from "../deltaEngine/rowCluster";

const FIXTURE_DIR = path.join(__dirname, "../../../../tests/fixtures/20766");
const read = (name: string) => fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8");
const shopText = read("shop_text.txt");
const sorText = read("sor3_text.txt");
const shopWords = JSON.parse(read("shop_words.json")) as PdfWord[];

function higherRows(withComparisonWords: boolean) {
  const visualLines = buildPdfTextLines(shopWords);
  const anchors = buildEstimateRowAnchorsFromLines(visualLines, { sourceDocumentRole: "shop", sourceDocumentId: "shop-20766" });
  const generated = buildRequiredEstimatorDeltaFindings({
    anchors,
    visualLines,
    sourcePdfName: "Shop 20766.pdf",
    sourceDocumentId: "shop-20766",
    sourceDocumentRole: "shop",
    sourcePdfHash: "fixture-20766-shop",
    uploadedFileNames: ["Shop 20766.pdf", "SOR3.pdf"],
    sourceText: shopText,
    comparisonEstimateTexts: [{ sourceDocumentId: "sor-20766", fileName: "SOR3.pdf", text: sorText, estimateRole: "carrier" }],
    // An image-only SOR: no word layer, so the typed lane cannot run.
    comparisonEstimateWords: withComparisonWords ? undefined : [],
    extractionWarnings: [],
  });
  return generated.forensic?.rows?.higher ?? [];
}

describe("our sheet's hours keep their printed column when the comparison has no word layer", () => {
  const pages = pdfWordsToEnginePages(shopWords);
  const typed = parseEstimateRows(pages, emptyRowParseDiagnostics());
  const printed = parseSubtotalsFromWords(pages);
  const typedByLine = new Map(typed.map((row) => [row.line, row]));
  const rows = higherRows(false);

  it("our typed cells reconcile to the printed SUBTOTALS (the condition the fix rests on)", () => {
    const body = printed?.page ? typed.filter((row) => row.page <= printed.page!) : typed;
    const sum = (key: "labor" | "paint") => Math.round(body.reduce((total, row) => total + (row[key] ?? 0), 0) * 10) / 10;
    expect(printed?.labor).not.toBeNull();
    expect(Math.abs(sum("labor") - printed!.labor!)).toBeLessThanOrEqual(0.2);
    expect(Math.abs(sum("paint") - printed!.paint!)).toBeLessThanOrEqual(0.2);
  });

  it("every row whose hours match its typed cells in total takes the typed column split, values unchanged", () => {
    expect(rows.length).toBeGreaterThan(10);
    let compared = 0;
    let paintOnly = 0;
    for (const row of rows) {
      const cells = row.lineNumber === null ? undefined : typedByLine.get(row.lineNumber);
      if (!cells) continue;
      const total = (row.labor ?? 0) + (row.paint ?? 0);
      if (Math.abs(total - ((cells.labor ?? 0) + (cells.paint ?? 0))) > 0.05) continue;
      compared++;
      expect([row.lineNumber, row.labor, row.paint]).toEqual([row.lineNumber, cells.labor ?? null, cells.paint ?? null]);
      if ((cells.paint ?? 0) > 0 && !(cells.labor ?? 0)) paintOnly++;
    }
    expect(compared).toBeGreaterThan(10);
    // Refinish-only rows (a lone value in the paint column) are where the text lane read labor.
    expect(paintOnly).toBeGreaterThan(0);
  });
});
