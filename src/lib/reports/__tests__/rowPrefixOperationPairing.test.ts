/**
 * The CCC row prefix, and the operation it carries, through the typed delta
 * engine.
 *
 * A CCC Supplement of Record prints a supplement tag and marker glyphs between
 * the line number and the operation: "39 * <> S02 Rpr LT Upper cover". The
 * estimate's own legend defines "<>" as "the refinish operation WILL NOT be
 * performed as a separate procedure from the other panels"; it is not part of
 * the line's identity. A reader that skipped only "#"/"*" keyed that line as
 * SRPRUPPERCOVER, never equal to the shop's "* Rpr LT Upper cover", so the
 * shop's repair line (3.0 hr + 1.8 paint) paired with the carrier's R&I line of
 * the same panel (0.8 hr) and reported a labor shortfall the documents do not
 * show, while the carrier's identical repair line read as carrier-only. The
 * same reader serialized every tagged carrier row with a null operation and
 * "S01 R&I …" left in its description.
 *
 * Lines are de-identified, in the prints' shapes.
 */
import { describe, expect, it } from "vitest";
import { buildEstimateRowAnchorsFromLines, buildPdfTextLines, type PdfWord } from "../citationDensityRowAnchors";
import { buildRequiredEstimatorDeltaFindings } from "../annotatedCitationDensityEstimate";
import { deltaRowFromRawText, type EstimateDeltaRow } from "../estimateDeltaMatcher";
import { estimateFromDeltaRows } from "../appraisalSummary/estimateFromDeltaRows";
import { canonKey, readRowPrefix, startsWithRepairOperation } from "../deltaEngine/estimateNormalize";
import { pairAndCompare } from "../deltaEngine/deltaPair";
import { parseEstimateRows, parsePage, type ColRanges, type EstimateRow, type Word } from "../deltaEngine/rowCluster";

describe("the row-prefix reader", () => {
  it("reads glyphs, supplement tag and operation off a supplement line", () => {
    expect(readRowPrefix("* <> S02 Rpr LT Upper cover")).toEqual({
      glyphs: ["*", "<>"],
      refinishNotSeparate: true,
      supplementTag: "S02",
      afterMarkers: "Rpr LT Upper cover",
      op: "Rpr",
      body: "LT Upper cover",
    });
    expect(readRowPrefix("S01 R&I R&I bumper cover")).toMatchObject({ supplementTag: "S01", op: "R&I", body: "R&I bumper cover" });
    expect(readRowPrefix("** S01 Repl A/M Flex additive")).toMatchObject({ glyphs: ["**"], op: "Repl", body: "A/M Flex additive" });
  });

  it("reads the glued form, where no space separates glyph, tag and operation", () => {
    expect(readRowPrefix("*<>S01RprBumper cover primed")).toMatchObject({
      glyphs: ["*", "<>"],
      refinishNotSeparate: true,
      supplementTag: "S01",
      op: "Rpr",
      body: "Bumper cover primed",
    });
  });

  it("leaves a description that merely opens with S or an operation-like word whole", () => {
    expect(readRowPrefix("SOLID trim")).toMatchObject({ supplementTag: null, op: null, body: "SOLID trim" });
    expect(readRowPrefix("S2000 badge")).toMatchObject({ supplementTag: null, body: "S2000 badge" });
    expect(readRowPrefix("REPLACEMENT PANEL")).toMatchObject({ op: null, body: "REPLACEMENT PANEL" });
    expect(readRowPrefix("Add for Clear Coat")).toMatchObject({ op: null, body: "Add for Clear Coat" });
    expect(readRowPrefix("* Rpr LT Upper cover").refinishNotSeparate).toBe(false);
  });

  it("keys a supplement line exactly like its shop twin", () => {
    expect(canonKey("* <> S02 Rpr LT Upper cover").key).toBe(canonKey("* Rpr LT Upper cover").key);
    expect(canonKey("* S01 R&I LT Upper cover").key).toBe(canonKey("* Rpr LT Upper cover").key);
    // The tag was replaced by a space, so the ^-anchored op strip missed and
    // only one of the two R&I tokens came off: RIBUMPERCOVER vs BUMPERCOVER.
    expect(canonKey("S01 R&I R&I bumper cover").key).toBe(canonKey("R&I R&I bumper cover").key);
    expect(canonKey("*<>S01RprBumper cover primed").key).toBe(canonKey("* Rpr Bumper cover primed").key);
  });

  it("finds the operation behind every marker a discard rule sees", () => {
    expect(startsWithRepairOperation("12 * S01 Rpr Bumper cover")).toBe(true);
    expect(startsWithRepairOperation("39 * <> S02 Rpr LT Upper cover")).toBe(true);
  });
});

describe("the row reader behind the prefix", () => {
  const COLS: ColRanges = { qty: [300, 340], price: [360, 420], labor: [440, 490], paint: [510, 560] };
  let y = 0;
  const line = (tokens: Array<[string, number]>): Word[] => {
    y += 12;
    return tokens.map(([text, x]) => ({ text, x0: x, x1: x + text.length * 5, top: y, bottom: y + 9 }));
  };

  it("keeps a zero-value tagged operation row (an included R&I) as a row", () => {
    const rows = parsePage(
      line([["71", 40], ["S01", 60], ["R&I", 80], ["Light", 100], ["bar", 130]]),
      1,
      COLS,
      { section: "ROOF", prev: null, pendingStub: null }
    );
    expect(rows.map((row) => row.line)).toEqual([71]);
  });

  it("learns a document's mangled operation glyph from the operation position behind the tag", () => {
    // A broken text layer prints Repl as "Rqpl" on every row; the token after
    // the supplement tag is the one in the operation position.
    const words: Word[] = [
      ...line([["Line", 20], ["Oper", 60], ["Description", 120], ["Qty", 305], ["Extended", 365], ["Labor", 445], ["Paint", 515]]),
      ...line([["1", 20], ["FENDER", 60]]),
      ...["Fender", "Fender liner", "Fender bracket", "Fender molding"].flatMap((desc, index) =>
        line([[String(index + 2), 20], ["S01", 40], ["Rqpl", 65], ...desc.split(" ").map((word, at): [string, number] => [word, 100 + at * 45]), ["1", 310], ["10.00", 370]])
      ),
    ];
    const rows = parseEstimateRows(new Map([[1, words]]));
    expect(rows.map((row) => row.key)).toEqual(["Fender", "Fender liner", "Fender bracket", "Fender molding"].map((desc) => canonKey(`Repl ${desc}`).key));
  });
});

function engineRow(line: number, rawDesc: string, labor: number | null, paint: number | null, section = "REARBUMPER"): EstimateRow {
  const key = canonKey(rawDesc);
  return {
    page: 1,
    line,
    section,
    qty: 0,
    price: 0,
    labor,
    paint,
    laborClass: "",
    part: null,
    rawDesc,
    key: key.key,
    side: key.side,
    cells: {},
  };
}

describe("same-key pairing prefers the same operation", () => {
  it("pairs the shop's repair line with the carrier's identical repair line, not the R&I printed before it", () => {
    const shopRpr = engineRow(59, "* Rpr LT Upper cover", 3.0, 1.8);
    const carrierRi = engineRow(38, "* S01 R&I LT Upper cover", 0.8, 0);
    const carrierRpr = engineRow(39, "* <> S02 Rpr LT Upper cover", 3.0, 1.8);
    const result = pairAndCompare([shopRpr], [carrierRi, carrierRpr]);
    expect(result.pairs.map((pair) => [pair.subject.line, pair.competing.line])).toEqual([[59, 39]]);
    expect(result.findings).toEqual([]);
    expect(result.competingOnly.map((row) => row.line)).toEqual([38]);
  });

  it("matches exact operations across all subjects before any cross-operation pair", () => {
    // Document order would let the shop's Repl take the carrier's R&I (both
    // candidates differ in operation), leaving the shop's R&I the Rpr.
    const result = pairAndCompare(
      [engineRow(1, "Repl Tail lamp", 1.0, 0), engineRow(2, "R&I Tail lamp", 0.3, 0)],
      [engineRow(11, "S01 R&I Tail lamp", 0.3, 0), engineRow(12, "S01 Rpr Tail lamp", 1.0, 0)]
    );
    expect(result.pairs.map((pair) => [pair.subject.line, pair.competing.line])).toEqual([
      [1, 12],
      [2, 11],
    ]);
  });

  it("still pairs across operations when nothing better exists (an operation change)", () => {
    const result = pairAndCompare([engineRow(1, "Repl Tail lamp", 1.0, 0)], [engineRow(11, "S01 Rpr Tail lamp", 1.0, 0)]);
    expect(result.pairs.map((pair) => [pair.subject.line, pair.competing.line])).toEqual([[1, 11]]);
  });
});

describe("the dispute report's line read", () => {
  it("takes the operation and supplement off a description that still carries the prefix", () => {
    const parsed = deltaRowFromRawText({ rawText: "39 Rpr LT Upper cover 0 0.00 3.0 1.8", section: "REAR BUMPER" })!;
    const row: EstimateDeltaRow = { ...parsed, opCode: null, description: "<> S02 Rpr LT Upper cover" };
    const estimate = estimateFromDeltaRows({
      role: "carrier",
      fileName: "carrier.pdf",
      rows: [row],
      totals: { parts: 0, misc: 0, labor: [], paintSupplies: { hours: 0, rate: 0, cost: 0 }, subtotal: 0, tax: 0, grandTotal: 0 },
      userCategory: "other",
      text: "",
    });
    expect(estimate.lines[0]).toMatchObject({ line: 39, oper: "Rpr", desc: "LT Upper cover", supplement: "S02" });
  });
});

/* ---------- the typed lane end to end, on synthetic word layers ---------- */

type PrintRow =
  | { line: number; section: string }
  | { line: number; prefix: string[]; desc: string; qty?: string; price?: string; labor?: string; paint?: string }
  | { tail: string };

function printWords(rows: PrintRow[]): PdfWord[] {
  const out: PdfWord[] = [];
  const push = (text: string, x: number, y: number) =>
    out.push({ pageNumber: 1, text, normalizedText: text.toLowerCase(), x, y, width: text.length * 4.5, height: 9, pageWidth: 612, pageHeight: 792 });
  for (const [text, x] of [["Line", 30], ["Oper", 80], ["Description", 150], ["Qty", 340], ["Extended", 380], ["Price", 420], ["Labor", 470], ["Paint", 530]] as const)
    push(text, x, 100);
  let y = 120;
  for (const row of rows) {
    y += 14;
    if ("tail" in row) {
      let x = 30;
      for (const token of row.tail.split(" ")) {
        push(token, x, y);
        x += token.length * 4.5 + 6;
      }
      continue;
    }
    push(String(row.line), 30, y);
    if ("section" in row) {
      push(row.section, 80, y);
      continue;
    }
    let x = 50;
    for (const token of row.prefix) {
      push(token, x, y);
      x += token.length * 4.5 + 6;
    }
    x = Math.max(x, 110);
    for (const token of row.desc.split(" ")) {
      push(token, x, y);
      x += token.length * 4.5 + 4;
    }
    push(row.qty ?? "0", 345, y);
    push(row.price ?? "0.00", 385, y);
    if (row.labor) push(row.labor, 472, y);
    if (row.paint) push(row.paint, 532, y);
  }
  return out;
}

const printText = (rows: PrintRow[]) =>
  rows
    .map((row) =>
      "tail" in row
        ? row.tail
        : "section" in row
          ? `${row.line} ${row.section}`
          : [row.line, ...row.prefix, row.desc, row.qty ?? "0", row.price ?? "0.00", row.labor ?? "", row.paint ?? ""].join(" ")
    )
    .join("\n");

const totals = (body: number, paint: number, parts: number): PrintRow[] => {
  const total = (parts + body * 60 + paint * 60).toFixed(2);
  return [
    { tail: "ESTIMATE TOTALS" },
    { tail: "Category Basis Rate Cost $" },
    { tail: `Parts ${parts.toFixed(2)}` },
    { tail: `Body Labor ${body.toFixed(1)} hrs @ $ 60.00 /hr ${(body * 60).toFixed(2)}` },
    { tail: `Paint Labor ${paint.toFixed(1)} hrs @ $ 60.00 /hr ${(paint * 60).toFixed(2)}` },
    { tail: `Subtotal ${total}` },
    { tail: `Grand Total ${total}` },
  ];
};

const NAMES = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet"];
const filler = (start: number): PrintRow[] =>
  NAMES.map((name, index) => ({ line: start + index, prefix: ["Repl"], desc: `Synthetic bracket ${name}`, qty: "1", price: (10 + index).toFixed(2) }));

describe("a shop estimate against a supplement of record (typed lane)", { timeout: 60_000 }, () => {
  const shop: PrintRow[] = [
    { line: 1, section: "FRONT BUMPER" },
    { line: 2, prefix: ["R&I"], desc: "R&I bumper cover", labor: "Incl." },
    { line: 3, prefix: ["*", "Rpr"], desc: "Bumper cover", labor: "4.0", paint: "2.8" },
    { line: 4, section: "REAR BUMPER" },
    { line: 5, prefix: ["*", "Rpr"], desc: "LT Upper cover", labor: "3.0", paint: "1.8" },
    { line: 6, section: "MISC" },
    ...filler(7),
    ...totals(9.5, 4.6, 145),
  ];
  const carrier: PrintRow[] = [
    { line: 1, section: "FRONT BUMPER" },
    { line: 2, prefix: ["S01", "R&I"], desc: "R&I bumper cover", labor: "Incl." },
    { line: 3, prefix: ["*", "<>", "S02", "Rpr"], desc: "Bumper cover", labor: "4.0", paint: "2.8" },
    { line: 4, section: "REAR BUMPER" },
    { line: 5, prefix: ["*", "S01", "R&I"], desc: "LT Upper cover", labor: "0.8", paint: "0.0" },
    { line: 6, prefix: ["*", "<>", "S02", "Rpr"], desc: "LT Upper cover", labor: "3.0", paint: "1.8" },
    { line: 7, prefix: ["S01", "R&I"], desc: "R&I bumper cover", labor: "1.7", paint: "0.0" },
    { line: 8, section: "MISC" },
    ...filler(9),
    ...totals(7.0, 4.6, 145),
  ];
  const shopWords = printWords(shop);
  const visualLines = buildPdfTextLines(shopWords);
  const generated = buildRequiredEstimatorDeltaFindings({
    anchors: buildEstimateRowAnchorsFromLines(visualLines, { sourceDocumentRole: "shop", sourceDocumentId: "shop" }),
    visualLines,
    sourcePdfName: "shop.pdf",
    sourceDocumentId: "shop",
    sourceDocumentRole: "shop",
    sourcePdfHash: "synthetic-shop",
    uploadedFileNames: ["shop.pdf", "carrier.pdf"],
    sourceText: printText(shop),
    comparisonEstimateTexts: [{ sourceDocumentId: "carrier", fileName: "carrier.pdf", text: printText(carrier), estimateRole: "carrier" }],
    comparisonEstimateWords: [{ fileName: "carrier.pdf", estimateRole: "carrier", words: printWords(carrier), textLayerReliable: true }],
    extractionWarnings: [],
  });
  const lowerRow = (line: number) => generated.forensic!.rows.lower.find((row) => row.lineNumber === line);
  const lowerOnlySummary = generated.findings.find((finding) => /totals-lower-only-lines/.test(finding.id))?.currentSupportSummary ?? "";

  it("serializes each carrier row with its operation, a clean description and its supplement tag; the quoted text stays verbatim", () => {
    expect(lowerRow(5)).toMatchObject({ opCode: "R&I", description: "LT Upper cover", supplementTag: "S01" });
    expect(lowerRow(6)).toMatchObject({ opCode: "Rpr", description: "LT Upper cover", supplementTag: "S02" });
    expect(lowerRow(7)).toMatchObject({ opCode: "R&I", description: "R&I bumper cover", supplementTag: "S01" });
    expect(lowerRow(6)?.rawText).toMatch(/^6 \* <> S02 Rpr LT Upper cover /);
  });

  it("pairs the shop's repair line with the carrier's identical repair line: no labor difference", () => {
    expect(generated.forensic!.rows.equalPairs).toContainEqual({ higherLine: 5, lowerLine: 6 });
    expect(generated.forensic!.rows.deltas.filter((delta) => delta.higherRow.lineNumber === 5)).toEqual([]);
  });

  it("lists the carrier's R&I line and its REAR bumper cover R&I as carrier-only, never as duplicates of the shop's lines", () => {
    expect(lowerOnlySummary).toContain("L5 R&I LT Upper cover (0.8 hr) [REAR BUMPER]");
    expect(lowerOnlySummary).toContain("L7 R&I R&I bumper cover (1.7 hr) [REAR BUMPER]");
    expect(lowerOnlySummary).not.toMatch(/possible duplicate/);
    expect(lowerOnlySummary).not.toMatch(/S0\d|<>|changed line/i);
  });
});
