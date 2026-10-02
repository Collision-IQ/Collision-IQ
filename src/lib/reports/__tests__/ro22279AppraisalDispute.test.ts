/**
 * RO 22279 — 2024 Hyundai Kona SE AWD. Shop final (CCC ONE, $5,671.72) and
 * shop post-teardown ($6,104.48) against the carrier's Supplement of Record 1
 * ($4,408.16), an IMAGE-ONLY print (no text layer) read by the upload OCR.
 * The Forensic Estimate Analysis shipped; the Appraisal Dispute Report did not.
 *
 * D1 — OCR dropped decimal points in fixed-format cells: "1 5.00 T" read
 *      "1 500 T" on four lines ($20.00 unread) and "0.5 M" read "05 M". The
 *      strict line guard found the carrier's lines $20.00 short and refused.
 * D2 — the totals block read "Paint Labor 52hrs @ $65.00 /hr 338.00" (5.2)
 *      and "Mechanical Labor 05hrs" (0.5): the ledger closed on false hours
 *      ("73.3 hr theirs") and the hours-coverage gate read 20%.
 * D3 — the shop prints its column header once; rows above that header's y on
 *      the next page (L34 skid plate, L35 reinforcement) and rows whose 8pt
 *      band held unrelated text on later pages (post-TD L31-L33) were demoted
 *      to guide rows: $1,006.99 of shop parts unread.
 * D4 — "86671BE000" split into "86671BE 000": no Hyundai part number read on
 *      either sheet, so no part could match by number.
 * D5 — three estimates on the case: the lower side pooled Shop final's lines
 *      under the SOR's totals, and the dispute report was skipped silently.
 * D6 — the SOR's page-1 VIN OCR'd O for 9: a false "VINs differ" warning.
 * D7 — what the report then said: a false "not on our sheet" for the carrier's
 *      A/M bumper cover (our L30 is the same part, OEM), "theirs 0.0 hr" for
 *      calibration (their road test left out), and an O/0 part-number
 *      "variant". (Download redaction still turns "Skid plate SE" into
 *      "Skid plate [REDACTED_PLATE]" as on main: every way of keeping the
 *      trim word that was tried also kept some real plate, and privacy
 *      fails closed.)
 * D8 — the class: any carrier line-read SHORTFALL refused the whole report.
 *      On a CCC carrier it is now stated, bounded and disclosed, and no line
 *      item is argued (a counterpart may sit on a line not read); an
 *      over-read still refuses.
 *
 * Fixtures are PII-free: tests/fixtures/22279/sor1_ocr_rows_text.txt is the
 * production OCR text of the SOR's line-item, totals and summary pages (page 1
 * and every name, claim number and VIN removed); dispute_input.json is the
 * production-path adapter input for Shop final vs SOR-1, identity removed.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { OCR_TEXT_HEADER, isOcrRecoveredText } from "@/lib/attachments/ocrTextMarker";
import { repairTokens, restoreDroppedHoursDecimal } from "../deltaEngine/estimateNormalize";
import { parseTotalsFromWords, type Word } from "../deltaEngine/rowCluster";
import { parseEstimateRowsForPlatform, parseEstimateTotalsForPlatform } from "../estimatePlatform";
import {
  assessHoursCoverage,
  findOcrDroppedPointCell,
  parseCccEstimateRow,
  parseCccSubtotalsCells,
  type EstimateDeltaRow,
} from "../estimateDeltaMatcher";
import { buildEstimateRowAnchorsFromLines, buildPdfTextLines, type PdfTextLine, type PdfWord } from "../citationDensityRowAnchors";
import { adaptForensicToPlainSummary } from "../plainLanguageSummaryAdapter";
import {
  describeExcludedComparisons,
  readPrintedEstimator,
  sameEstimator,
  readLatestPrintedTimestamp,
  readPrintedEstimateVersion,
  selectComparisonCounterpart,
} from "../comparisonCounterpart";
import { findVin, isValidVin } from "../claimIdentityGate";
import { NonLaborParseError } from "../appraisalSummary/nonLaborBuckets";
import type { Estimate } from "../appraisalSummary/types";
import {
  buildPlainSummaryDocument,
  buildPlainSummaryModel,
  plainSummaryDocumentText,
  renderPlainSummaryPdf,
  type PlainSummaryInput,
} from "../plainLanguageSummary";
import {
  buildAnnotatedCitationDensityEstimatePdf,
  buildRequiredEstimatorDeltaFindings,
  CitationDensityAnnotationError,
} from "../annotatedCitationDensityEstimate";

const FIXTURE_DIR = path.join(__dirname, "../../../../tests/fixtures/22279");
const fixture = (name: string) => readFileSync(path.join(FIXTURE_DIR, name), "utf8");
const sorText = fixture("sor1_ocr_rows_text.txt");
const disputeInput: PlainSummaryInput = JSON.parse(fixture("dispute_input.json"));

const sum = (rows: EstimateDeltaRow[], column: "price" | "labor" | "paint") =>
  Math.round(rows.reduce((total, row) => total + (row[column] ?? 0), 0) * 100) / 100;
const row = (rows: EstimateDeltaRow[], line: number) => rows.find((candidate) => candidate.lineNumber === line)!;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe("D1 — OCR dropped decimal points, restored only where the printed SUBTOTALS prove them", () => {
  const read = parseEstimateRowsForPlatform(repairTokens(sorText));

  it("reads the SOR's lines to its own printed SUBTOTALS 2,487.54 / 16.8 / 5.2", () => {
    expect(isOcrRecoveredText(sorText)).toBe(true);
    expect(read.platform).toBe("ccc");
    expect(sum(read.rows, "price")).toBe(2487.54);
    expect(sum(read.rows, "labor")).toBe(16.8);
    expect(sum(read.rows, "paint")).toBe(5.2);
  });

  it("restores exactly the five dropped cells and marks them", () => {
    for (const line of [38, 39, 44, 48]) {
      expect(row(read.rows, line)).toMatchObject({ qty: 1, price: 5, restoredCells: ["price"] });
    }
    expect(row(read.rows, 38).description).toBe("Cover Car");
    expect(row(read.rows, 42)).toMatchObject({ labor: 0.5, laborType: "M", paint: 0, restoredCells: ["labor"] });
    expect(read.rows.filter((r) => r.restoredCells).map((r) => r.lineNumber).sort((a, b) => a! - b!)).toEqual([38, 39, 42, 44, 48]);
  });

  it("reads the OCR'd '**' marker as the marker, so the operation code survives", () => {
    expect(row(read.rows, 26)).toMatchObject({ opCode: "Repl", description: "A/M Bumper cover w/o park", partNumber: "HY1100280" });
    expect(row(read.rows, 29)).toMatchObject({ opCode: "Repl", partNumber: "1919.1402" });
    expect(row(read.rows, 12)).toMatchObject({ opCode: "Repl", partNumber: "GEU3151R-72909" });
    expect(row(read.rows, 11)).toMatchObject({ description: "Opt OEM Emblem", partNumber: "86302-BE200" });
  });

  it("a text layer (no OCR header) is read exactly as before", () => {
    const plain = parseEstimateRowsForPlatform(repairTokens(sorText.replace(OCR_TEXT_HEADER, ""))).rows;
    expect(row(plain, 38).price).toBeNull();
    expect(sum(plain, "price")).toBe(2467.54);
    expect(plain.some((r) => r.restoredCells)).toBe(false);
  });

  it("refuses a repair the printed SUBTOTALS do not prove, column by column", () => {
    const rows = parseEstimateRowsForPlatform(repairTokens(sorText.replace("SUBTOTALS 2,487.54 16.8", "SUBTOTALS 2,488.54 16.8"))).rows;
    expect(row(rows, 38).price).toBeNull();
    expect(row(rows, 42).labor).toBe(0.5);
  });

  it("never reads an integer as a price on a print that leaves cells blank, even when the sum would close", () => {
    const coincidence = [
      OCR_TEXT_HEADER,
      "Line Oper Description Part Number Qty Extended Labor Paint",
      "1 REAR BUMPER",
      "2 Repl Bumper cover 52711AB000 1 412.00 2.0 2.5",
      "3 # Wheel 18 1919 0.5 0.0",
      "4 # Cover Car 1 500 T 0.2 0.0",
      "5 # Clips 1 19.I9 0.0 0.0",
      "SUBTOTALS 436.19 2.7 2.5",
    ].join("\n");
    const rows = parseEstimateRowsForPlatform(coincidence).rows;
    expect(rows.some((r) => r.restoredCells?.includes("price"))).toBe(false);
  });

  it("finds a candidate only where one cell of a full CCC grid lacks its point", () => {
    expect(findOcrDroppedPointCell("38 # Cover Car 1 500 T 0.2 0.0")).toMatchObject({ column: "price", from: "500", to: "5.00" });
    expect(findOcrDroppedPointCell("42 # Rpr Post-repair Diagnostic Scan 0 0.00 05 M 0.0")).toMatchObject({ column: "labor", to: "0.5" });
    for (const negative of [
      "29 ** Repl A/M Skid plate SE, SEL 1919.1402 1 398.43 Incl. 0.0",
      "45 # S01 Cavity Wax Plus-3M 08852 1 15.40 0.2 0.0",
      "118 # Adhesive-3M 07333 1 156.63 T 0.2 0.0",
      "1 500 T 02 0.0",
      "1 0500 T 0.2 0.0",
      "7 # Call CCC 800.637.8511 1 0.00 0.0 0.0",
      "21 # Mask for primer 1 500 T 0.3",
    ]) {
      expect(findOcrDroppedPointCell(negative)).toBeNull();
    }
  });

  it("reconciles only against a SUBTOTALS line printed as exactly its three cells", () => {
    expect(parseCccSubtotalsCells("SUBTOTALS 2,487.54 16.8 5.2")).toEqual({ price: 2487.54, labor: 16.8, paint: 5.2 });
    expect(parseCccSubtotalsCells("SUBTOTALS 2,487.54 168 5.2")).toBeNull();
    expect(parseCccSubtotalsCells("SUBTOTALS2,977.6817.67.8")).toBeNull();
    expect(parseCccSubtotalsCells("51 # Recheck subtotals 0 0.00 0.0 0.0\n| SUBTOTALS 2,487.54 16.8 5.2")).toEqual({ price: 2487.54, labor: 16.8, paint: 5.2 });
  });
});

describe("D2 — totals-block hours: a dropped point restored only when rate × cost prove it", () => {
  it("reads the SOR totals at the printed hours, every cost unchanged", () => {
    const totals = parseEstimateTotalsForPlatform(sorText)!;
    const category = (name: string) => totals.categories.find((entry) => entry.category === name);
    expect(category("Body Labor")).toMatchObject({ hours: 16.3, rate: 65, cost: 1059.5 });
    expect(category("Paint Labor")).toMatchObject({ hours: 5.2, rate: 65, cost: 338 });
    expect(category("Mechanical Labor")).toMatchObject({ hours: 0.5, rate: 100, cost: 50 });
    expect(totals.subtotal).toBe(4158.64);
    expect(totals.grandTotal).toBe(4408.16);
  });

  it("restores nothing a reading already proves or neither reading proves", () => {
    expect(restoreDroppedHoursDecimal("52", 65, 338)).toBe(5.2);
    expect(restoreDroppedHoursDecimal("05", 100, 50)).toBe(0.5);
    expect(restoreDroppedHoursDecimal("-05", 100, -50)).toBe(-0.5);
    expect(restoreDroppedHoursDecimal("53", 62.55, 331.51)).toBe(5.3); // a half cent of print rounding
    expect(restoreDroppedHoursDecimal("2.1", 100, 360)).toBeNull(); // a printed point; Mitchell books sublet into labor
    expect(restoreDroppedHoursDecimal("10", 50, 500)).toBeNull(); // reconciles as read
    expect(restoreDroppedHoursDecimal("52", 65, 340)).toBeNull();
    expect(restoreDroppedHoursDecimal("5", 100, 50)).toBeNull();
    expect(restoreDroppedHoursDecimal("52", null, 338)).toBeNull();
  });

  it("the word lane restores the same point, so merging word categories cannot put 52 hr back", () => {
    let x = 0;
    const word = (text: string, top: number): Word => {
      const w = { text, x0: x, x1: x + 6 * text.length, top, bottom: top + 8 };
      x += 6 * text.length + 4;
      return w;
    };
    const rowWords = (top: number, texts: string[]) => {
      x = 40;
      return texts.map((text) => word(text, top));
    };
    const words = [
      ...rowWords(100, ["ESTIMATE", "TOTALS"]),
      ...rowWords(120, ["Paint", "Labor", "52hrs", "@", "$", "65.00", "/hr", "338.00"]),
      ...rowWords(132, ["Mechanical", "Labor", "05hrs", "@", "$", "100.00", "/hr", "50.00"]),
      ...rowWords(144, ["Subtotal", "388.00"]),
    ];
    const rows = parseTotalsFromWords(new Map([[3, words]]));
    expect(rows.find((r) => r.category === "Paint Labor")?.hours).toBe(5.2);
    expect(rows.find((r) => r.category === "Mechanical Labor")?.hours).toBe(0.5);
  });

  it("measures the SOR's labor coverage against its printed hours, not ten times them", () => {
    const rows = parseEstimateRowsForPlatform(repairTokens(sorText)).rows;
    const coverage = assessHoursCoverage(rows, sorText);
    expect(coverage.printedHours).toBe(31.8);
    expect(coverage.gate).toBe(false);
  });
});

describe("D3 — continuation pages keep the rows printed under their own chrome", () => {
  const line = (pageNumber: number, y: number, text: string): PdfTextLine => ({
    pageNumber,
    text,
    normalizedText: text.toLowerCase(),
    x: 30,
    y,
    width: 6 * text.length,
    height: 8,
    pageWidth: 612,
    pageHeight: 792,
    words: [],
  });
  const chrome = (pageNumber: number) => [
    line(pageNumber, 29, "Preliminary Estimate"),
    line(pageNumber, 48, "RO Number: 00000"),
    line(pageNumber, 62, "2024 HYUN Kona SE AWD 4D UTV 4-2.0L Gasoline"),
    line(pageNumber, 741.6, `10/1/2026 6:10:33 PM 300060 Page ${pageNumber}`),
  ];
  const lines = [
    ...chrome(1),
    line(1, 300, "Owner: on the cover page"),
    ...chrome(2),
    line(2, 92, "Line Oper Description Part Number Qty Extended Labor Paint"),
    line(2, 120, "28 REAR BUMPER"),
    line(2, 134, "29 O/H bumper assy 2.5"),
    line(2, 642.4, "black"),
    line(2, 655.9, "31 * Rpr RT Cover SE, SEL 1.0 1.1"),
    line(2, 683, "33 Repl Skid plate SE, SEL 86671BE000 1 642.05 Incl."),
    ...chrome(3),
    line(3, 80.5, "34 * Repl Skid plate SE, SEL 86671BE000 1 504.49 Incl."),
    line(3, 94, "35 * Repl Reinforcement 86631BE200 1 502.50 0.1"),
    line(3, 107.5, "36 Repl Prep unprimed bumper 1 0.7"),
    line(3, 121, "37 # Repl RT Front pillar structural bulb 1063943-00-A 1 1.00"),
    line(3, 134.6, "6.5mm"),
    line(3, 520.5, "SUBTOTALS 2,977.68 17.6 7.8"),
    line(3, 643, "Sales Tax $ 5,758.94 @ 6.0000 % 345.54"),
    ...chrome(4),
    line(4, 638.5, "Transportation and Safety Administration. PDR=Paintless Dent Repair."),
  ];
  const anchors = buildEstimateRowAnchorsFromLines(lines, { sourceDocumentRole: "shop" });
  const typeOf = (lineNumber: string) => anchors.find((anchor) => anchor.lineNumber === lineNumber)?.anchorType;

  it("rows above the y where an earlier page printed the header are estimate lines", () => {
    expect(typeOf("34")).toBe("estimate_line");
    expect(typeOf("35")).toBe("estimate_line");
    expect(typeOf("36")).toBe("estimate_line");
  });

  it("an 8pt band holding different text on three pages is not a footer", () => {
    expect(typeOf("31")).toBe("estimate_line");
    expect(typeOf("33")).toBe("estimate_line");
  });

  it("a wrapped dimension never takes a line number, and a part number is never labor", () => {
    expect(anchors.filter((anchor) => anchor.lineNumber === "6")).toEqual([]);
    expect(anchors.find((anchor) => anchor.lineNumber === "37")?.labor).not.toBe(1063943);
    const ids = anchors.map((anchor) => anchor.anchorId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  const wordFixture = (ro: string, name: string) =>
    JSON.parse(readFileSync(path.join(FIXTURE_DIR, `../${ro}/${name}`), "utf8")) as PdfWord[];

  it("a rescued last row never absorbs the totals block below SUBTOTALS (RO 20766 shop L99)", () => {
    const fixtureAnchors = buildEstimateRowAnchorsFromLines(buildPdfTextLines(wordFixture("20766", "shop_words.json")), {
      sourceDocumentRole: "shop",
      sourceDocumentId: "shop-20766",
    });
    const l99 = fixtureAnchors.find((anchor) => anchor.lineNumber === "99" && anchor.anchorType === "estimate_line");
    expect(l99).toBeDefined();
    expect(l99!.rowText).not.toMatch(/Calibration\/Reset|hrs @/);
    expect(l99!.height).toBeLessThan(20);
  });

  it("a footer print stamp never joins the last row of a print too short to measure its footer (RO 22084 shop, pages 1-2)", () => {
    const twoPages = wordFixture("22084", "shop_words.json").filter((word) => word.pageNumber <= 2);
    const fixtureAnchors = buildEstimateRowAnchorsFromLines(buildPdfTextLines(twoPages), { sourceDocumentRole: "shop", sourceDocumentId: "shop-22084" });
    const l31 = fixtureAnchors.find((anchor) => anchor.lineNumber === "31" && anchor.anchorType === "estimate_line");
    expect(l31?.rowText).toMatch(/R&I LT Outer support/);
    expect(l31?.rowText).not.toMatch(/Page \d|\d{1,2}:\d{2}/);
    expect(l31!.height).toBeLessThan(30);
  });

  it("a wrapped '3 Ft' is never appended after a row's value cells (masking tape is not 3.0 hr)", () => {
    for (const [ro, line] of [["20766", "48"], ["20766", "55"]] as const) {
      const fixtureAnchors = buildEstimateRowAnchorsFromLines(buildPdfTextLines(wordFixture(ro, "shop_words.json")), { sourceDocumentRole: "shop", sourceDocumentId: `shop-${ro}` });
      const tape = fixtureAnchors.find((anchor) => anchor.lineNumber === line && anchor.anchorType === "estimate_line");
      expect(tape?.rowText).toMatch(/Masking Tape/);
      expect(tape?.rowText).not.toMatch(/\b3 Ft\b/);
    }
  });

  it("anchor ids are unique and line 6 is the real row (RO 22084 SOR-5)", () => {
    const fixtureAnchors = buildEstimateRowAnchorsFromLines(buildPdfTextLines(wordFixture("22084", "sor5_words.json")), {
      sourceDocumentRole: "carrier",
      sourceDocumentId: "sor5",
    });
    const ids = fixtureAnchors.map((anchor) => anchor.anchorId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(fixtureAnchors.find((anchor) => anchor.anchorId === "sor5:p3:6:estimate_line")?.rowText).toMatch(/R&I LT\/Rear R&I wheel/);
  });
});

describe("D4 — a part number with a two-letter interior is one token", () => {
  it("reads Hyundai part numbers whole on both sheets", () => {
    expect(parseCccEstimateRow("34 * Repl Skid plate SE, SEL 86671BE000 1 504.49 Incl.")).toMatchObject({
      description: "Skid plate SE, SEL",
      partNumber: "86671BE000",
      price: 504.49,
    });
    expect(parseCccEstimateRow("28 S01 Repl Reinforcement 86631BE200 1 508.25 0.1 0.0")).toMatchObject({
      description: "Reinforcement",
      partNumber: "86631BE200",
    });
  });

  it("still splits a glued qty off a word with '/' or '-', or after a glued line number", () => {
    expect(parseCccEstimateRow("59Repl High voltage system deactivate/activate1m2.8M")).toMatchObject({
      description: "High voltage system deactivate/activate",
      qty: 1,
      labor: 2.8,
      laborType: "M",
    });
    expect(parseCccEstimateRow("45#Post-scan1m")).toMatchObject({ description: "Post-scan", qty: 1 });
    expect(parseCccEstimateRow("45#S01Detail1m1.0")).toMatchObject({ description: "Detail", qty: 1, labor: 1 });
    expect(parseCccEstimateRow("41S01ReplCalibration1m1.4M")).toMatchObject({ description: "Calibration", qty: 1, labor: 1.4 });
    // A short tail other than a qty marker stays on the part number.
    expect(parseCccEstimateRow("1 Repl Bumper bracket 62090-5AA0B 1 89.00 0.3 0.0")).toMatchObject({ description: "Bumper bracket", partNumber: "62090-5AA0B", qty: 1, price: 89 });
    expect(parseCccEstimateRow("1 Repl Bracket 57704FL01B 1 245.00 0.0 0.0")).toMatchObject({ partNumber: "57704FL01B", qty: 1, price: 245 });
    // A one- or two-digit qty with a lowercase marker splits after any word.
    expect(parseCccEstimateRow("5#S01Clip retainer 8mm10m")).toMatchObject({ description: "Clip retainer 8mm", qty: 10 });
    expect(parseCccEstimateRow("6#S01Wheel weights 1/4oz12m")).toMatchObject({ description: "Wheel weights 1/4oz", qty: 12 });
    // A qty marker after a description word holding digits splits as on main.
    for (const [row, description] of [
      ["45#Nameplate 4MATIC1m", "Nameplate 4MATIC"],
      ["45#Bracket 2019-UP1m", "Bracket"],
      ["45#Wiper blade 22in1m", "Wiper blade 22in"],
      ["6 # Wheel 2019-Up1m", "Wheel 2019-Up"],
      ["45#Recharge A/C system w/R-1234yf1", "Recharge A/C system w/R-1234yf"],
    ]) {
      expect(parseCccEstimateRow(row)).toMatchObject({ description, qty: 1 });
    }
    expect(parseCccEstimateRow("14 Repl Bumper cover 86511-BE000 1 412.00 2.0 2.5")).toMatchObject({ description: "Bumper cover", partNumber: "86511-BE000" });
    expect(parseCccEstimateRow("12 Repl Grille C25J75 1 45.00 0.3")).toMatchObject({ partNumber: "C25J75" });
  });

  it("reads the fixture HV rows exactly as before (RO 21995 SOR-3 L59)", () => {
    const rows = parseEstimateRowsForPlatform(repairTokens(readFileSync(path.join(FIXTURE_DIR, "../21995/sor3_rows_text.txt"), "utf8"))).rows;
    expect(row(rows, 59)).toMatchObject({ description: "High voltage system deactivate/activate", qty: 1, labor: 2.8 });
  });
});

describe("D5 — one counterpart per run", () => {
  const shopFinal = {
    fileName: "Shop_final_22279.pdf",
    sourceDocumentId: "final",
    text: ["Preliminary Estimate", "10/1/2026 6:10:33 PM 300060 Page 1", "ESTIMATE TOTALS", "Subtotal 5,350.68", "Sales Tax $ 5,350.68 @ 6.0000 % 321.04", "Grand Total 5,671.72"].join("\n"),
  };
  const sor = { fileName: "SOR-1_22279.pdf", sourceDocumentId: "sor", text: sorText };

  it("measures our estimate against the carrier's, in either upload order, and names what it left out", () => {
    for (const candidates of [[shopFinal, sor], [sor, shopFinal]]) {
      const selection = selectComparisonCounterpart(candidates, { sourceParty: "shop" });
      expect(selection.counterpart?.fileName).toBe("SOR-1_22279.pdf");
      expect(describeExcludedComparisons(selection)).toMatch(
        /^Compared against SOR-1_22279\.pdf only\. Not compared: Shop_final_22279\.pdf \(its name marks it as a shop estimate, like the annotated one\)/
      );
    }
  });

  it("takes the latest of the other party's estimates by the supplement number they print", () => {
    const sor3 = { fileName: "SOR-3.pdf", text: readFileSync(path.join(FIXTURE_DIR, "../20766/sor3_text.txt"), "utf8") };
    const sor5 = { fileName: "SOR-5.pdf", text: readFileSync(path.join(FIXTURE_DIR, "../22084/sor5_text.txt"), "utf8") };
    expect(readPrintedEstimateVersion(sor3.text)).toBe(3);
    expect(readPrintedEstimateVersion(sor5.text)).toBe(5);
    for (const candidates of [[sor3, sor5], [sor5, sor3]]) {
      const selection = selectComparisonCounterpart(candidates, { sourceParty: "shop" });
      expect(selection.counterpart?.fileName).toBe("SOR-5.pdf");
      expect(selection.basis).toBe("printed supplement number");
    }
  });

  it("an insurer's brand in a name is weaker than a word naming the document theirs; when the brand-named one is later, the run cannot say which is theirs", () => {
    const mitchell = readFileSync(path.join(FIXTURE_DIR, "../22132/sor3_mitchell_text.txt"), "utf8");
    expect(readPrintedEstimateVersion(mitchell)).toBe(3);
    // A shop names its own files after the insurer too ("USAA 22279 Final.pdf"),
    // so a later brand-named estimate may be either party's.
    const latest = { fileName: "Progressive Supplement 3.pdf", text: mitchell, estimateRole: "carrier" as const };
    const earlier = { fileName: "SOR 1.pdf", text: mitchell.replace(/^([ \t]*Supplement[ \t]+)3([ \t]*)$/m, "$11$2"), estimateRole: "carrier" as const };
    expect(readPrintedEstimateVersion(earlier.text)).toBe(1);
    for (const candidates of [[latest, earlier], [earlier, latest]]) {
      const selection = selectComparisonCounterpart(candidates, { sourceParty: "shop" });
      // Unsettled: the dispute report is refused; the forensic run uses the most plainly marked.
      expect(selection.counterpart?.fileName).toBe("SOR 1.pdf");
      expect(selection.unidentified.map((c) => c.fileName).sort()).toEqual(["Progressive Supplement 3.pdf", "SOR 1.pdf"]);
    }
  });

  it("a label the caller only guessed admits nothing: an unmarked shop version never displaces the SOR", () => {
    const guessed = { ...shopFinal, fileName: "22279 final.pdf", estimateRole: "carrier" as const };
    const labelled = { ...sor, estimateRole: "carrier" as const };
    for (const candidates of [[guessed, labelled], [labelled, guessed]]) {
      expect(selectComparisonCounterpart(candidates, { sourceParty: "shop" }).counterpart?.fileName).toBe("SOR-1_22279.pdf");
    }
  });

  it("knows every carrier the authorship test knows, as a whole word in the name", () => {
    const mitchell = readFileSync(path.join(FIXTURE_DIR, "../22132/sor3_mitchell_text.txt"), "utf8");
    const supplement1 = mitchell.replace(/^([ \t]*Supplement[ \t]+)3([ \t]*)$/m, "$11$2");
    for (const carrier of ["USAA", "Travelers", "Nationwide", "Liberty Mutual", "Farmers"]) {
      const latest = { fileName: `${carrier} Supplement 3.pdf`, text: mitchell, estimateRole: "carrier" as const };
      const earlier = { fileName: `${carrier} estimate.pdf`, text: supplement1, estimateRole: "carrier" as const };
      for (const candidates of [[latest, earlier], [earlier, latest]]) {
        expect(selectComparisonCounterpart(candidates, { sourceParty: "shop" }).counterpart?.fileName).toBe(`${carrier} Supplement 3.pdf`);
      }
    }
    // "Windsor" is not "SOR"; "SOR1_22279" still is.
    const windsor = { ...shopFinal, fileName: "Windsor Collision final.pdf", estimateRole: "carrier" as const };
    const sorGlued = { ...sor, fileName: "SOR1_22279.pdf", estimateRole: "carrier" as const };
    for (const candidates of [[windsor, sorGlued], [sorGlued, windsor]]) {
      expect(selectComparisonCounterpart(candidates, { sourceParty: "shop" }).counterpart?.fileName).toBe("SOR1_22279.pdf");
    }
  });

  it("an estimate printing our own estimator is ours, whatever its name or a note in it says (RO 22279 shop final renamed)", () => {
    const writtenBy = "Written By: JANE ROE, 739698";
    const source = `${writtenBy}\nPreliminary Estimate`;
    const theirs = { ...sor, estimateRole: "carrier" as const };
    for (const renamed of [
      { ...shopFinal, fileName: "USAA 22279 Final.pdf", estimateRole: "carrier" as const, text: `${writtenBy}\n${shopFinal.text}` },
      { ...shopFinal, fileName: "22279 final.pdf", estimateRole: "carrier" as const, text: `${writtenBy}\n${shopFinal.text}\nBLEND NOT ON USAA ESTIMATE, ADDED` },
    ]) {
      for (const candidates of [[renamed, theirs], [theirs, renamed]]) {
        const selection = selectComparisonCounterpart(candidates, { sourceParty: "shop", sourceText: source });
        expect(selection.counterpart?.fileName).toBe("SOR-1_22279.pdf");
        expect(selection.unidentified).toEqual([]);
        expect(describeExcludedComparisons(selection)).toMatch(/it prints the same estimator as the annotated estimate/);
      }
      // Without the printed estimator nothing proves it ours, and it prints
      // later than the SOR: the run cannot say which is theirs.
      const blind = selectComparisonCounterpart([renamed, theirs].map((c) => ({ ...c, text: c.text.replace(writtenBy, "") })), { sourceParty: "shop" });
      expect(blind.unidentified.length).toBe(2);
    }
  });

  it("several estimates and none identified as theirs: the pick is reported as unidentified", () => {
    const a = { ...shopFinal, fileName: "22279 final.pdf", estimateRole: "carrier" as const };
    const b = { ...sor, fileName: "22279 b.pdf", estimateRole: "carrier" as const };
    const selection = selectComparisonCounterpart([a, b], { sourceParty: "shop" });
    expect(selection.unidentified.map((c) => c.fileName).sort()).toEqual(["22279 b.pdf", "22279 final.pdf"]);
    // One left once our own named versions are set aside stands as a lone comparison would.
    const named = { ...shopFinal, estimateRole: "shop" as const };
    expect(selectComparisonCounterpart([named, b], { sourceParty: "shop" })).toMatchObject({ unidentified: [], counterpart: b });
  });

  it("reads party words through camel case and separators", () => {
    const unmarked = { ...shopFinal, fileName: "22279 final.pdf", estimateRole: "carrier" as const };
    for (const name of ["GeicoSupplement1.pdf", "State-Farm-Supplement-3.pdf", "Liberty_Mutual_Supp1.pdf", "InsuranceEstimate.pdf"]) {
      const theirs = { ...sor, fileName: name, estimateRole: "carrier" as const };
      for (const candidates of [[unmarked, theirs], [theirs, unmarked]]) {
        expect(selectComparisonCounterpart(candidates, { sourceParty: "shop" })).toMatchObject({ counterpart: theirs, unidentified: [] });
      }
    }
    const ours = { ...shopFinal, fileName: "ShopFinal22279.pdf", estimateRole: "shop" as const };
    const geico = { ...sor, fileName: "GeicoSupplement3.pdf", estimateRole: "carrier" as const };
    expect(selectComparisonCounterpart([ours, geico], { sourceParty: "shop" }).counterpart).toBe(geico);
  });

  it("an insurer's estimate named 'Appraisal' against an unmarked one: the run cannot say which is theirs", () => {
    const appraisal = { ...sor, fileName: "Progressive Appraisal.pdf", estimateRole: "shop" as const, text: `USAA approved estimate\n${sorText}` };
    const unmarked = { ...shopFinal, fileName: "22279 final.pdf", estimateRole: "carrier" as const };
    for (const candidates of [[appraisal, unmarked], [unmarked, appraisal]]) {
      expect(selectComparisonCounterpart(candidates, { sourceParty: "shop" }).unidentified.length).toBe(2);
    }
  });

  it("an estimate whose totals cannot be read never makes a lone readable one unidentified", () => {
    const b = { ...sor, fileName: "22279 b.pdf", estimateRole: "carrier" as const };
    const blank = { fileName: "Estimate.pdf", text: "", estimateRole: "carrier" as const };
    for (const candidates of [[b, blank], [blank, b]]) {
      expect(selectComparisonCounterpart(candidates, { sourceParty: "shop" })).toMatchObject({ counterpart: b, unidentified: [] });
    }
  });

  it("a redacted or placeholder estimator proves nothing; a real name does", () => {
    for (const placeholder of ["[REDACTED], 739698", "XXXXXXXX, 1", "ESTIMATOR, REDACTED", "ADJUSTER NAME, License Number: 1", "NAME REDACTED, 2", "X, 3"]) {
      expect(readPrintedEstimator(`Written By: ${placeholder}`)).toBeNull();
    }
    // Any redaction token voids the read, listed or not, bracketed or worded.
    for (const redacted of ["[REDACTED_PERSON], 1", "Redacted for privacy, 2", "NAME WITHHELD, 3", "[PII], 4", "[CONFIDENTIAL], 5", "<name>, 6", "TBD, 7", "Staff, 8", "***, 9"]) {
      expect(readPrintedEstimator(`Written By: ${redacted}`)).toBeNull();
    }
    const tokenSor = { ...sor, estimateRole: "carrier" as const, text: `Written By: [REDACTED_PERSON], License Number: 271128\n${sorText}` };
    const tokenFinal = { ...shopFinal, fileName: "22279 final.pdf", estimateRole: "carrier" as const, text: `Written By: [REDACTED_PERSON], 739698\n${shopFinal.text}` };
    expect(sameEstimator("Written By: [REDACTED_PERSON], 739698", tokenSor.text)).toBe(false);
    expect(selectComparisonCounterpart([tokenFinal, tokenSor], { sourceParty: "shop", sourceText: "Written By: [REDACTED_PERSON], 739698" }).counterpart).toBe(tokenSor);
    // Short and initialled real names still count.
    for (const [printed, name] of [["J. R. SMITH, 1", "J R SMITH"], ["MIKE, 2", "MIKE"], ["JIWON NA, 3", "JIWON NA"], ["OSKAR, 4", "OSKAR"]]) {
      expect(readPrintedEstimator(`Written By: ${printed}`)).toBe(name);
    }
    expect(sameEstimator("Written By: [REDACTED], 739698", "Written By: [REDACTED], License Number: 271128")).toBe(false);
    expect(readPrintedEstimator("Written By: Jane  Roe, License Number: 1")).toBe("JANE ROE");
    // The SOR with the same placeholder as ours is still theirs.
    const ours = "Written By: [REDACTED], 739698\nPreliminary Estimate";
    const theirs = { ...sor, estimateRole: "carrier" as const, text: `Written By: [REDACTED], License Number: 271128\n${sorText}` };
    const final = { ...shopFinal, fileName: "22279 final.pdf", estimateRole: "carrier" as const, text: `Written By: [REDACTED], 739698\n${shopFinal.text}` };
    expect(selectComparisonCounterpart([final, theirs], { sourceParty: "shop", sourceText: ours }).counterpart?.fileName).toBe("SOR-1_22279.pdf");
  });

  it("the insurer's versions named differently are one appraiser's: the latest is compared", () => {
    const appraiser = "Written By: MONICA ROE, License Number: 271128";
    const older = { ...sor, fileName: "Insurance estimate 22279.pdf", estimateRole: "carrier" as const, text: `${appraiser}\n${sorText.replace(/Supplement of Record 1 with Summary/g, "Estimate of Record")}` };
    const latest = { ...sor, fileName: "USAA_22279.pdf", estimateRole: "carrier" as const, text: `${appraiser}\n${sorText}` };
    for (const candidates of [[older, latest], [latest, older]]) {
      expect(selectComparisonCounterpart(candidates, { sourceParty: "shop" })).toMatchObject({ counterpart: latest, unidentified: [] });
    }
    // Nothing ties them together: unsettled, measured against the most plainly marked.
    const blind = selectComparisonCounterpart([older, latest].map((c) => ({ ...c, text: c.text.replace(appraiser, "") })), { sourceParty: "shop" });
    expect(blind.unidentified.length).toBe(2);
    expect(blind.counterpart?.fileName).toBe("Insurance estimate 22279.pdf");
    // Two shop versions by one (unlicensed) estimator never join that way.
    const estimator = "Written By: JOHN DOE, 739698";
    const shopNamedAdjuster = { ...shopFinal, fileName: "Supplement request to adjuster 22279.pdf", estimateRole: "carrier" as const, text: `${estimator}\n${shopFinal.text.replace("10/1/2026", "9/22/2026")}` };
    const shopNamedUsaa = { ...shopFinal, fileName: "USAA 22279 Final.pdf", estimateRole: "carrier" as const, text: `${estimator}\n${shopFinal.text}` };
    const real = { ...latest, fileName: "SOR-1_22279.pdf" };
    expect(selectComparisonCounterpart([shopNamedAdjuster, real, shopNamedUsaa], { sourceParty: "shop" }).unidentified.length).toBeGreaterThan(0);
  });

  it("an independent appraiser's estimate is the weakest mark: it never outranks the insurer's brand", () => {
    const ia = { ...shopFinal, fileName: "Independent Appraiser 22279.pdf", estimateRole: "carrier" as const, text: `Written By: JOHN DOE, 1\n${shopFinal.text.replace("10/1/2026", "9/22/2026")}` };
    const theirs = { ...sor, fileName: "USAA Supplement 1.pdf", estimateRole: "carrier" as const };
    for (const candidates of [[ia, theirs], [theirs, ia]]) {
      expect(selectComparisonCounterpart(candidates, { sourceParty: "shop" })).toMatchObject({ counterpart: theirs, unidentified: [] });
    }
    // The insurer's own estimate named "Staff appraiser" is backed by its licensed
    // writer, so a later brand-named file (our final) never outranks it.
    const staff = { ...sor, fileName: "Staff appraiser 22279.pdf", estimateRole: "carrier" as const, text: `Written By: MONICA ROE, License Number: 271128\n${sorText}` };
    const ourBranded = { ...shopFinal, fileName: "USAA 22279 Final.pdf", estimateRole: "carrier" as const };
    for (const candidates of [[staff, ourBranded], [ourBranded, staff]]) {
      const selection = selectComparisonCounterpart(candidates, { sourceParty: "shop" });
      expect(selection.counterpart).toBe(staff);
      expect(selection.unidentified.length).toBe(2);
    }
    // A licensed independent appraiser printed after the SOR is never theirs.
    const licensedIa = { ...shopFinal, fileName: "Independent Appraiser 22279.pdf", estimateRole: "carrier" as const, text: `Written By: JOHN DOE, License Number: 5\n${shopFinal.text}` };
    expect(selectComparisonCounterpart([licensedIa, { ...sor, estimateRole: "carrier" as const }], { sourceParty: "shop" }).unidentified.length).toBe(2);
    // Printed after the SOR, it makes the run unsettled instead of being called theirs.
    const later = { ...ia, text: `Written By: JOHN DOE, 1\n${shopFinal.text}` };
    const sorNamed = { ...sor, estimateRole: "carrier" as const };
    expect(selectComparisonCounterpart([later, sorNamed], { sourceParty: "shop" })).toMatchObject({ counterpart: sorNamed });
    expect(selectComparisonCounterpart([later, sorNamed], { sourceParty: "shop" }).unidentified.length).toBe(2);
  });

  it("names an Estimate of Record as such, never 'supplement 0'", () => {
    const eor = { fileName: "Carrier EOR.pdf", estimateRole: "carrier" as const, text: sorText.replace(/Supplement of Record 1 with Summary/g, "Estimate of Record") };
    const note = describeExcludedComparisons(selectComparisonCounterpart([eor, sor], { sourceParty: "shop" }));
    expect(note).toMatch(/Carrier EOR\.pdf \(it prints Estimate of Record; SOR-1_22279\.pdf prints supplement 1\)/);
    expect(note).not.toMatch(/supplement 0/);
  });

  it("reads print stamps glued to the next token, and leaves a single comparison alone", () => {
    expect(readLatestPrintedTimestamp("9/22/2026 11:03:55 AM300060Page 1\n10/1/2026 6:10:33 PM 300060")).toBe(Date.UTC(2026, 9, 1, 18, 10, 33));
    expect(readPrintedEstimateVersion("NET COST OF SUPPLEMENT 1,855.12")).toBeNull();
    const single = selectComparisonCounterpart([sor], { sourceParty: "shop" });
    expect(single.counterpart).toBe(sor);
    expect(describeExcludedComparisons(single)).toBeNull();
  });
});

describe("D6 — a VIN misread on one page is corrected by the same print's own valid VIN", () => {
  const VIN = "5YJSA1E65NF488007";
  it("adopts a later labeled VIN only where the fold guessed, and only when two later reads agree", () => {
    expect(isValidVin(VIN)).toBe(true);
    const filler = "Line items and page furniture. ".repeat(4);
    const page = (vin: string) => `VIN: ${vin} Production Date\n${filler}\n`;
    expect(findVin(page("5YJSA1E65NFO88007") + page(VIN) + page(VIN))).toBe(VIN);
    // One later read is not enough: it could itself be the misread of a VIN with no check digit.
    expect(findVin(page("5YJSA1E65NFO88007") + page(VIN))).toBe("5YJSA1E65NF088007");
    // ... and one printed VIN behind two labels is still one read.
    expect(findVin(`${page("5YJSA1E65NFO88007")}VIN VIN: ${VIN} x\n`)).toBe("5YJSA1E65NF088007");
  });

  it("never swaps in a different vehicle's VIN", () => {
    // Each label on its own page, as a print states them.
    const page = (vin: string) => `VIN: ${vin} Production Date: 03/2024\n${"Line items and page furniture. ".repeat(4)}\n`;
    // A misread digit (8 for 7 is not a fold guess) and a two-position difference both stand as read.
    expect(findVin(page("5YJSA1E65NF488008") + page(VIN))).toBe("5YJSA1E65NF488008");
    expect(findVin(page("5YJSA1E65NFO8800O") + page(VIN))).toBe("5YJSA1E65NF088000");
    // A valid first read is returned as before.
    expect(findVin(page(VIN) + page("5YJSA1E65NF488008"))).toBe(VIN);
  });
});

describe("D7 — the Appraisal Dispute Report for Shop final vs SOR-1 is produced and reads truthfully", () => {
  const model = buildPlainSummaryModel(clone(disputeInput));
  const text = plainSummaryDocumentText(buildPlainSummaryDocument(model));

  it("closes the ledger to the printed difference with the printed hours", () => {
    expect(model.ledger.gap).toBe(1263.56);
    expect(model.ledger.laborHours).toEqual({ shop: 25.4, carrier: 22, diff: 3.4, dollars: 242.5 });
    expect(model.ledger.laborRate).toBe(215);
    expect(model.ledger.paintMaterials).toBe(244.4);
    expect(model.ledger.nonLaborNet).toBe(490.14);
    expect(model.ledger.tax).toBe(71.52);
    expect(model.ledger.unreadCarrierLines).toBe(0);
    expect(text).not.toMatch(/73\.3 hr|52\.0 hr/);
  });

  it("raises no false carrier-only line and no part-number variant that is the same part", () => {
    expect(model.flags.filter((f) => f.kind === "carrierOnlyHighDollar")).toEqual([]);
    const variants = model.flags.filter((f) => f.kind === "partNumberVariant").map((f) => f.lines.carrier?.[0]);
    expect(variants).toEqual([12]); // the Opt OEM nameplate's supplier number is a real difference
    expect(text).not.toMatch(/not on our sheet/);
  });

  it("compares calibration on both sides' road tests and names the priced lines", () => {
    expect(text).toMatch(
      /Ours 0\.5 hr, theirs 0\.5 hr: the same hours\. The difference is in the priced lines: ours \$636\.50, theirs \$375\.00\./
    );
  });

  it("renders past the wording gate", async () => {
    expect((await renderPlainSummaryPdf(model)).pageCount).toBeGreaterThan(0);
  });
});

describe("D8 — a carrier line-read shortfall is stated and bounded, never a refusal", () => {
  const withCarrierLine = (line: number, patch: Record<string, unknown>) => {
    const input = clone(disputeInput);
    input.carrier.lines = input.carrier.lines.map((l) => (l.line === line ? { ...l, ...patch } : l));
    return input;
  };

  it("an unread $5.00 line is disclosed with the rows it could move; the total is unchanged", async () => {
    const model = buildPlainSummaryModel(withCarrierLine(38, { price: undefined }));
    expect(model.ledger.unreadCarrierLines).toBe(5);
    expect(model.ledger.gap).toBe(1263.56);
    const text = plainSummaryDocumentText(buildPlainSummaryDocument(model));
    expect(text).toMatch(/the lines this read could price add up to \$2,482\.54, so \$5\.00 is on lines whose price was not read/);
    expect(text).toMatch(/the Labor rate row is smaller and the parts row larger by that amount/);
    expect(text).toMatch(/If any of the \$5\.00 on their lines that was not read is a labor-rate adjustment/);
    // A dropped row and an unread price cell look the same to the ledger, and
    // a dropped row hides labor as well as dollars: no item is argued.
    expect(model.items).toEqual([]);
    expect(text).not.toMatch(/No counterpart on their sheet/);
    expect(text).toMatch(/No item is listed: part of their sheet was not read, so any line of ours could have its counterpart on a line that was not read/);
    expect(text).not.toMatch(/No hours difference/);
    expect(text).toMatch(/Get a readable copy of their estimate/);
    expect((await renderPlainSummaryPdf(model)).pageCount).toBeGreaterThan(0);
  });

  it("a dropped carrier row that carries only labor is a partial read too: hours are measured against the printed hours", () => {
    for (const line of [42, 49, 40]) {
      const input = clone(disputeInput);
      input.carrier.lines = input.carrier.lines.filter((l) => l.line !== line);
      const model = buildPlainSummaryModel(input);
      expect(model.ledger.unreadCarrierLines).toBe(0);
      expect(model.ledger.unreadCarrierHours).toBeGreaterThan(0);
      expect(model.items).toEqual([]);
      expect(model.facts.adasSentence ?? "").not.toMatch(/more hours of calibration/);
      const text = plainSummaryDocumentText(buildPlainSummaryDocument(model));
      expect(text).not.toMatch(/No counterpart on their sheet|theirs 0\.0 hr/);
      expect(text).toMatch(/prints 22\.0 hr of labor; the lines this read carry \d+\.\d hr, so \d+\.\d hr of it was not read: a line, or a line's hours, that this read missed/);
    }
  });

  it("a small unread amount never claims a high-dollar line cannot be ruled out, and no variant rests on an unread line", () => {
    const model = buildPlainSummaryModel(withCarrierLine(38, { price: undefined }));
    const text = plainSummaryDocumentText(buildPlainSummaryDocument(model));
    expect(text).not.toMatch(/cannot be ruled out/);
    expect(text).toMatch(/Nothing on the lines read needs resolving first; part of their sheet was not read/);
    expect(model.flags.filter((f) => f.kind === "partNumberVariant")).toEqual([]);
  });

  it("an over-read still refuses: a price was misread", () => {
    expect(() => buildPlainSummaryModel(withCarrierLine(38, { price: 500 }))).toThrow(NonLaborParseError);
  });

  it("a non-CCC carrier still refuses: its line sums do not measure a shortfall", () => {
    const input = withCarrierLine(38, { price: undefined });
    (input.carrier as Estimate).platform = "mitchell";
    expect(() => buildPlainSummaryModel(input)).toThrow(NonLaborParseError);
  });
});

describe("D5 — the builder narrows to one counterpart and never skips the dispute report in silence", () => {
  async function subjectPdf() {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([612, 792]);
    ["Preliminary Estimate", "Claim #: 00-0000000-01", "2023 Lexus IS 300 AWD", "Net Cost of Repairs $28,840.26", "5 Repl RT Blind spot radar 8816253050 1203.26 1.6 M", "155 Repl RT Side rail 5760153070 727.53 12.5"].forEach(
      (text, index) => page.drawText(text, { x: 42, y: 752 - index * 16, size: 9, font })
    );
    return pdf.save();
  }
  const carrierText = ["Supplement of Record S2", "Claim #: 00-0000000-01", "Total Cost of Repairs $15,441.55", "31 Repl RT Side rail 57601-53070 727.53 2.5"].join("\n");
  const shopVersionText = ["Preliminary Estimate", "Claim #: 00-0000000-01", "Net Cost of Repairs $20,100.00", "31 Repl RT Side rail 57601-53070 727.53 2.5"].join("\n");
  const build = async (comparisonEstimateTexts: Parameters<typeof buildAnnotatedCitationDensityEstimatePdf>[0]["comparisonEstimateTexts"]) =>
    buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes: await subjectPdf(),
      sourcePdfName: "Shop Final Estimate.pdf",
      sourceDocumentId: "shop-final",
      sourceText: "Preliminary Estimate\nClaim #: 00-0000000-01\nNet Cost of Repairs $28,840.26",
      comparisonEstimateTexts,
      findings: [],
      findingGenerator: buildRequiredEstimatorDeltaFindings,
      request: { includeLegend: false, estimateRole: "shop" },
    });

  it("names the estimate it did not compare", async () => {
    const result = await build([
      { fileName: "Shop prelim.pdf", sourceDocumentId: "prelim", estimateRole: "shop", text: shopVersionText },
      { fileName: "Carrier SOR S2.pdf", sourceDocumentId: "sor2", estimateRole: "carrier", text: carrierText },
    ]);
    expect(result.warnings.join("\n")).toMatch(/Compared against Carrier SOR S2\.pdf only\. Not compared: Shop prelim\.pdf/);
  });

  it("an estimate for another vehicle on the case still blocks the run; it is never 'a version not compared'", async () => {
    const otherVehicle = ["Preliminary Estimate", "Claim #: 99-9999999-01", "VIN: 1HGCM82633A004352", "Net Cost of Repairs $9,100.00", "31 Repl RT Side rail 57601-53070 727.53 2.5"].join("\n");
    await expect(
      build([
        { fileName: "Other vehicle.pdf", sourceDocumentId: "other", estimateRole: "shop", text: otherVehicle },
        { fileName: "Carrier SOR S2.pdf", sourceDocumentId: "sor2", estimateRole: "carrier", text: carrierText },
      ])
    ).rejects.toBeInstanceOf(CitationDensityAnnotationError);
  });

  it("the caller's label decides: a shop note or an appraiser's 'prepared by' never makes a comparison the insurer's", async () => {
    for (const comparison of [
      { fileName: "Spartan Collision prelim.pdf", text: `${shopVersionText}\nBLEND NOT ON USAA ESTIMATE, ADDED` },
      { fileName: "Appraisal - J Smith.pdf", text: `${carrierText}\nPrepared by: J. Smith, Independent Appraiser` },
      { fileName: "Appraisal S2.pdf", text: `USAA approved estimate\n${carrierText}` },
    ]) {
      const result = await build([{ ...comparison, sourceDocumentId: "cmp", estimateRole: "shop" }]);
      expect(result.plainSummaryExportId).toBeUndefined();
      expect(result.warnings.join("\n")).toMatch(
        new RegExp(`${comparison.fileName.replace(/[.]/g, "\\.")} was not identified as the insurer's estimate: it is labelled a shop estimate\\. Naming the insurer's file with "SOR" or "carrier" as a separate word`)
      );
    }
  });

  it("several unmarked estimates and none identified as the insurer's: no dispute report, and it says why", async () => {
    const result = await build([
      { fileName: "22279 final.pdf", sourceDocumentId: "final", estimateRole: "carrier", text: shopVersionText },
      { fileName: "22279 b.pdf", sourceDocumentId: "b", estimateRole: "carrier", text: carrierText },
    ]);
    expect(result.plainSummaryExportId).toBeUndefined();
    expect(result.warnings.join("\n")).toMatch(
      /Appraisal Dispute Report not produced: nothing printed on 22279 (final|b)\.pdf, 22279 (final|b)\.pdf settles which one is the insurer's estimate/
    );
  });

  it("a file named as a shop estimate stays the shop's whatever a note in it says", async () => {
    const result = await build([
      { fileName: "Shop prelim.pdf", sourceDocumentId: "prelim", estimateRole: "shop", text: `${shopVersionText}\nBLEND NOT ON USAA ESTIMATE, ADDED` },
    ]);
    expect(result.plainSummaryExportId).toBeUndefined();
    expect(result.warnings.join("\n")).toMatch(/Shop prelim\.pdf was not identified as the insurer's estimate: it is labelled a shop estimate/);
  });

  it("says why a shop-vs-shop run has no dispute report", async () => {
    const result = await build([{ fileName: "Shop prelim.pdf", sourceDocumentId: "prelim", estimateRole: "shop", text: shopVersionText }]);
    expect(result.plainSummaryExportId).toBeUndefined();
    expect(result.warnings.join("\n")).toMatch(/Appraisal Dispute Report not produced: .*Shop prelim\.pdf was not identified as the insurer's estimate: it is labelled a shop estimate/);
  });
});

/*
 * The adversarial review of this change found what a report generated on a
 * partial read, or from a wider read, could then claim. Each case below is a
 * reviewer's input, run on the real RO 21995 production rows or the RO 22279
 * dispute input.
 */
describe("review — what the report may claim when lines are unread or read differently", () => {
  const delta21995 = JSON.parse(readFileSync(path.join(FIXTURE_DIR, "../21995/delta_rows.json"), "utf8"));
  const text21995 = (name: string) => readFileSync(path.join(FIXTURE_DIR, `../21995/${name}`), "utf8");
  type Delta = typeof delta21995;
  const lowerRow = (d: Delta, line: number) => d.lower.find((r: EstimateDeltaRow) => r.lineNumber === line);
  function model21995(mutate: (d: Delta) => void) {
    const d = clone(delta21995);
    mutate(d);
    const adapted = adaptForensicToPlainSummary({
      reconciliation: d.reconciliation,
      rows: { higher: d.higher, lower: d.lower, deltas: d.deltas },
      higherDocumentName: "Shop final 21995.pdf",
      lowerDocumentName: "SOR-3 21995.pdf",
      higherText: text21995("shop_final_rows_text.txt"),
      lowerText: text21995("sor3_rows_text.txt"),
      vehicleLabel: "2026 Rivian R1S",
      roNumber: "21995",
      generatedAt: "2026-10-02T00:00:00.000Z",
    });
    if (!adapted.ok) throw new Error(adapted.reason);
    const m = buildPlainSummaryModel(adapted.input);
    return { m, text: plainSummaryDocumentText(buildPlainSummaryDocument(m)) };
  }

  it("a reuse flag never prints $0.00 for a price that was not read", () => {
    const { m, text } = model21995((d) => (lowerRow(d, 134).price = null));
    expect(m.ledger.unreadCarrierLines).toBe(63.47);
    expect(text).toMatch(/RT Water shield upper \(price not read, L134/);
    expect(text).not.toMatch(/\(\$0\.00, L134/);
  });

  it("an unread companion price never inflates the tires item", () => {
    const { m, text } = model21995((d) => (lowerRow(d, 77).price = null));
    expect(m.items.find((item) => /^Tires/.test(item.title))).toBeUndefined();
    expect(text).not.toMatch(/\$1,408\.60/);
  });

  it("on a partial read, no item is argued: an unread price and a dropped row look the same", () => {
    for (const mutate of [
      (d: Delta) => (lowerRow(d, 102).price = null),
      // Dropped: their L102 replaces the subframe with 5.5 hr, so "no
      // counterpart" for our crossmember R&I would be false.
      (d: Delta) => (d.lower = d.lower.filter((r: EstimateDeltaRow) => r.lineNumber !== 102)),
      (d: Delta) => (d.lower = d.lower.filter((r: EstimateDeltaRow) => r.lineNumber !== 134)),
      // Their oil pump's price unread: "they pay the part" is not shown.
      (d: Delta) => (lowerRow(d, 61).price = null),
      // A labor-only row dropped: their L2 R&I bumper (1.6 hr) is the counterpart of our O/H.
      (d: Delta) => (d.lower = d.lower.filter((r: EstimateDeltaRow) => r.lineNumber !== 2)),
    ]) {
      const { m, text } = model21995(mutate);
      expect(m.ledger.unreadCarrierLines + m.ledger.unreadCarrierHours).toBeGreaterThan(0);
      expect(m.items).toEqual([]);
      expect(text).not.toMatch(/No counterpart on their sheet|They pay the part/);
      expect(text).toMatch(/So no item is listed below/);
    }
  });

  it("'Check this first' never says nothing needs resolving while a carrier price is unread", () => {
    const dual = (d: Delta) => (lowerRow(d, 98).description = String(lowerRow(d, 98).description).replace(/quad-motor/i, "dual-motor"));
    expect(model21995(dual).text).toMatch(/Carrier L169 "Damper Module Assembly" \(\$1,980\.00\) is not on our sheet/);
    const { text } = model21995((d) => {
      dual(d);
      lowerRow(d, 169).price = null;
    });
    expect(text).not.toMatch(/Nothing on either sheet needs resolving/);
    expect(text).toMatch(/Nothing on the lines read needs resolving first\. \$1,980\.00 of their lines' prices was not read, so a high-dollar line only they wrote cannot be ruled out/);
  });

  it("a carrier row not read at all never inflates an item (dropped L77, L171)", () => {
    expect(model21995((d) => (d.lower = d.lower.filter((r: EstimateDeltaRow) => r.lineNumber !== 77))).text).not.toMatch(/\$1,408\.60/);
    const { m, text } = model21995((d) => (d.lower = d.lower.filter((r: EstimateDeltaRow) => r.lineNumber !== 171)));
    expect(text).not.toMatch(/theirs \$497\.00/);
    const transport = m.items.find((item) => /Transport/.test(item.title));
    expect(transport === undefined || transport.value <= 337.96).toBe(true);
  });

  it("a dropped carrier calibration row never prints our calibration as 'no counterpart'", () => {
    const input = clone(disputeInput);
    input.carrier.lines = input.carrier.lines.filter((l) => l.line !== 35);
    const text = plainSummaryDocumentText(buildPlainSummaryDocument(buildPlainSummaryModel(input)));
    expect(text).not.toMatch(/\$469\.00 part/);
  });

  it("'no price' is stated as what was read while any carrier price is unread", () => {
    const full = model21995(() => {});
    const partial = model21995((d) => (lowerRow(d, 75).price = null));
    const flag = (m: typeof full.m) => m.flags.find((f) => f.kind === "zeroPricedCarrierLine" && f.lines.carrier?.[0] === 57);
    expect(flag(full.m)?.text).toMatch(/^The carrier wrote "Forklift frame from lot" \(L57\) with no price/);
    expect(flag(partial.m)?.text).toMatch(/^No price was read for the carrier's "Forklift frame from lot" \(L57\)/);
  });

  it("a recycled part for the wrong drivetrain is still flagged", () => {
    const { m } = model21995((d) => (lowerRow(d, 98).partSource = ["RCY"]));
    expect(m.flags.find((f) => f.kind === "trimConflictPartNumber" && f.lines.carrier?.[0] === 98)).toBeDefined();
  });

  it("a high-dollar carrier line the matcher paired with a cheap namesake is still raised", () => {
    const { m } = model21995((d) => (d.higher = d.higher.filter((r: EstimateDeltaRow) => r.lineNumber !== 135)));
    expect(m.flags.find((f) => f.kind === "carrierOnlyHighDollar" && f.lines.carrier?.[0] === 102)).toBeDefined();
  });

  it("a carrier road test alone is not their calibration", () => {
    const input = clone(disputeInput);
    input.carrier.lines = input.carrier.lines.map((l) => (l.line === 35 ? { ...l, desc: "Four wheel alignment" } : l));
    input.pairs = input.pairs.map((p) => (p.carrierLine === 35 ? { kind: "missing" as const, shopLines: p.shopLines } : p));
    const text = plainSummaryDocumentText(buildPlainSummaryDocument(buildPlainSummaryModel(input)));
    expect(text).toMatch(/No counterpart on their sheet \(L45/);
    expect(text).not.toMatch(/they pay more than we wrote/);
    expect(text).not.toMatch(/ADAS calibration & diagnostics/);
  });

  it("a shop non-OEM part is a part-type difference, not a variant to confirm by VIN", () => {
    const input = clone(disputeInput);
    input.shop.lines = input.shop.lines.map((l) =>
      l.line === 30 ? { ...l, desc: "LKQ Bumper cover w/o park assist", partNumber: "HY1100280C", partSource: ["LKQ"] } : l
    );
    input.carrier.lines = input.carrier.lines.map((l) =>
      l.line === 26 ? { ...l, desc: "Bumper cover w/o park assist", partNumber: "86650BE020AS", partSource: [] } : l
    );
    const m = buildPlainSummaryModel(input);
    expect(m.flags.filter((f) => f.kind === "partNumberVariant" && f.lines.shop?.[0] === 30)).toEqual([]);
  });

  it("an unread calibration sublet price leaves the ADAS item worth its hours only", () => {
    const input = clone(disputeInput);
    input.carrier.lines = input.carrier.lines.map((l) => (l.line === 35 ? { ...l, price: undefined } : l));
    const m = buildPlainSummaryModel(input);
    const adas = m.items.find((item) => item.title === "ADAS calibration & diagnostics");
    expect(adas).toBeUndefined(); // 0.5 hr each side: nothing left to argue on hours alone
    expect(plainSummaryDocumentText(buildPlainSummaryDocument(m))).not.toMatch(/theirs none priced/);
  });
});
