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
  namesAnotherPartysEstimate,
  printedPartyConflict,
  readPrintedEstimator,
  readPrintedLetterhead,
  readPrintedFederalId,
  readPrintedWorkfileId,
  sameEstimator,
  samePrintedParty,
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

  it("a part number is never labor", () => {
    // (Stored-text lines carry no words, so a digit-led wrap keeps its text
    // reading here; word-layer prints measure the line-number column instead,
    // see rowAnchorWrappedLineNumber.test.ts.)
    expect(anchors.find((anchor) => anchor.lineNumber === "37")?.labor).not.toBe(1063943);
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
      // The wrap joins the description, ahead of the value cells.
      expect(tape?.rowText).not.toMatch(/\d\.\d{2}\s+T\s+3 Ft\s*$/);
    }
  });

  it("line 6 is the real row, never a wrapped \"6.5mm\" (RO 22084 SOR-5)", () => {
    const fixtureAnchors = buildEstimateRowAnchorsFromLines(buildPdfTextLines(wordFixture("22084", "sor5_words.json")), {
      sourceDocumentRole: "carrier",
      sourceDocumentId: "sor5",
    });
    const line6 = fixtureAnchors.filter((anchor) => anchor.anchorId === "sor5:p3:6:estimate_line");
    expect(line6).toHaveLength(1);
    expect(line6[0].rowText).toMatch(/R&I LT\/Rear R&I wheel/);
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

  // The synthetic fixture opens with a five-line banner; the print itself starts after it.
  const mitchellPrint = () => readFileSync(path.join(FIXTURE_DIR, "../22132/sor3_mitchell_text.txt"), "utf8").split("\n").slice(5).join("\n");

  it("an insurer's brand in a name is weaker than a word naming the document theirs; when the brand-named one is later, the run cannot say which is theirs", () => {
    const mitchell = mitchellPrint();
    expect(readPrintedEstimateVersion(mitchell)).toBe(3);
    // A shop names its own files after the insurer too ("USAA 22279 Final.pdf"),
    // so a later brand-named estimate printed under another letterhead may be
    // either party's.
    const latest = { fileName: "Progressive Supplement 3.pdf", text: `Conestoga Collision\n${mitchell}`, estimateRole: "carrier" as const };
    const earlier = { fileName: "SOR 1.pdf", text: mitchell.replace(/^([ \t]*Supplement[ \t]+)3([ \t]*)$/m, "$11$2"), estimateRole: "carrier" as const };
    expect(readPrintedEstimateVersion(earlier.text)).toBe(1);
    for (const candidates of [[latest, earlier], [earlier, latest]]) {
      const selection = selectComparisonCounterpart(candidates, { sourceParty: "shop" });
      // Unsettled: the dispute report is refused; the forensic run uses the most plainly marked.
      expect(selection.counterpart?.fileName).toBe("SOR 1.pdf");
      expect(selection.unidentified.map((c) => c.fileName).sort()).toEqual(["Progressive Supplement 3.pdf", "SOR 1.pdf"]);
    }
    // Under the same letterhead it is the same writer's print: the latest is compared.
    const sameLetterhead = { ...latest, text: mitchell };
    for (const candidates of [[sameLetterhead, earlier], [earlier, sameLetterhead]]) {
      expect(selectComparisonCounterpart(candidates, { sourceParty: "shop" })).toMatchObject({ counterpart: sameLetterhead, unidentified: [] });
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
    const mitchell = mitchellPrint();
    const supplement1 = mitchell.replace(/^([ \t]*Supplement[ \t]+)3([ \t]*)$/m, "$11$2");
    for (const carrier of ["USAA", "Travelers", "Nationwide", "Liberty Mutual", "Farmers"]) {
      const latest = { fileName: `${carrier} Supplement 3.pdf`, text: mitchell, estimateRole: "carrier" as const };
      const earlier = { fileName: `${carrier} estimate.pdf`, text: supplement1, estimateRole: "carrier" as const };
      for (const candidates of [[latest, earlier], [earlier, latest]]) {
        // Both print the insurer's letterhead, so they are one writer's: settled on the latest.
        expect(selectComparisonCounterpart(candidates, { sourceParty: "shop" })).toMatchObject({ counterpart: latest, unidentified: [] });
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
    // Our other version prints our estimator, so it is ours whatever its name.
    const ourEstimator = "Written By: JANE ROE, 739698";
    const unmarked = { ...shopFinal, fileName: "22279 final.pdf", estimateRole: "carrier" as const, text: `${ourEstimator}\n${shopFinal.text}` };
    for (const name of ["GeicoSupplement1.pdf", "State-Farm-Supplement-3.pdf", "Liberty_Mutual_Supp1.pdf", "InsuranceEstimate.pdf"]) {
      const theirs = { ...sor, fileName: name, estimateRole: "carrier" as const };
      for (const candidates of [[unmarked, theirs], [theirs, unmarked]]) {
        expect(selectComparisonCounterpart(candidates, { sourceParty: "shop", sourceText: ourEstimator })).toMatchObject({ counterpart: theirs, unidentified: [] });
      }
      // Nothing shows the unmarked one is ours: a brand alone does not settle it; a word naming the document does.
      const blind = selectComparisonCounterpart([{ ...unmarked, text: shopFinal.text }, theirs], { sourceParty: "shop" });
      expect(blind.counterpart).toBe(theirs);
      expect(blind.unidentified.length).toBe(name === "InsuranceEstimate.pdf" ? 0 : 2);
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
    // Either side hires an independent appraiser: set aside, it may have been
    // the insurer's own, so a brand-named estimate beside it is never
    // settled as theirs, however it is printed (a letterhead is easy to
    // misread: a cover letter's addressee, a shop named for a brand).
    const printedTheirs = { ...theirs, text: `USAA CASUALTY INSURANCE COMPANY\nWorkfile ID: 9f8e7d6c\n${sorText}` };
    for (const insurer of [theirs, printedTheirs]) {
      for (const candidates of [[ia, insurer], [insurer, ia]]) {
        const selection = selectComparisonCounterpart(candidates, { sourceParty: "shop", sourceText: "Workfile ID: a1b2c3d4" });
        expect(selection.counterpart).toBe(insurer);
        expect(selection.unidentified.length).toBe(2);
      }
    }
    // The insurer's own estimate named "Staff appraiser" is as plain as SOR, so a
    // later brand-named file (our final) never outranks it.
    const staff = { ...sor, fileName: "Staff appraiser 22279.pdf", estimateRole: "carrier" as const, text: `Written By: MONICA ROE, License Number: 271128\n${sorText}` };
    const ourBranded = { ...shopFinal, fileName: "USAA 22279 Final.pdf", estimateRole: "carrier" as const };
    for (const candidates of [[staff, ourBranded], [ourBranded, staff]]) {
      const selection = selectComparisonCounterpart(candidates, { sourceParty: "shop" });
      expect(selection.counterpart).toBe(staff);
      expect(selection.unidentified.length).toBe(2);
    }
    // Another party's appraiser, licensed or not, printed before or after, is set
    // aside: a license line does not say whose appraiser wrote it.
    const theirsSor = { ...sor, estimateRole: "carrier" as const };
    const theirsBrand = { ...sor, fileName: "USAA 22279.pdf", estimateRole: "carrier" as const };
    for (const name of ["Independent Appraiser 22279.pdf", "Insured's Appraiser 22279.pdf", "Policyholder appraiser estimate.pdf", "Customer appraiser 22279.pdf", "Owner's appraiser.pdf"]) {
      const other = { ...shopFinal, fileName: name, estimateRole: "carrier" as const, text: `Written By: JOHN DOE, License Number: 5\nItems omitted from the USAA estimate\n${shopFinal.text}` };
      // (An independent appraiser beside a brand-only name is pinned above.)
      for (const insurer of name.startsWith("Independent") ? [theirsSor] : [theirsSor, theirsBrand]) {
        for (const candidates of [[other, insurer], [insurer, other]]) {
          const selection = selectComparisonCounterpart(candidates, { sourceParty: "shop" });
          expect(selection.counterpart).toBe(insurer);
          // R13: either side hires an independent appraiser, so one printed after
          // the SOR may be the insurer's later version: compared against the SOR,
          // but not settled.
          expect(selection.unidentified.length).toBe(name.startsWith("Independent") ? 2 : 0);
        }
      }
    }
    // Printed before the SOR, it cannot be a later insurer version: settled on the SOR.
    const earlierIa = { ...shopFinal, fileName: "Independent Appraiser 22279.pdf", estimateRole: "carrier" as const, text: `Written By: JOHN DOE, License Number: 5\n${shopFinal.text.replace("10/1/2026", "9/20/2026")}` };
    for (const candidates of [[earlierIa, theirsSor], [theirsSor, earlierIa]]) {
      expect(selectComparisonCounterpart(candidates, { sourceParty: "shop" })).toMatchObject({ counterpart: theirsSor, unidentified: [] });
    }
    // An insurer mark anywhere in the name keeps it theirs, whatever else the name says.
    for (const name of ["Insurance appraiser estimate - customer copy.pdf", "USAA SOR 1 - Independent Appraiser.pdf", "USAA IA appraiser estimate.pdf", "State Farm appraiser estimate for insured.pdf"]) {
      const insurer = { ...sor, fileName: name, estimateRole: "carrier" as const };
      const ourOther = { ...shopFinal, fileName: "22279 supplement.pdf", estimateRole: "carrier" as const, text: `Written By: DANIEL KRAMER, 2\n${shopFinal.text}` };
      for (const candidates of [[insurer, ourOther], [ourOther, insurer]]) {
        expect(selectComparisonCounterpart(candidates, { sourceParty: "shop" }).counterpart).toBe(insurer);
      }
    }
    // Another party's appraiser set aside next to a lone unmarked estimate: unsettled, never "theirs".
    const insuredIa = { ...shopFinal, fileName: "Insured's Appraiser 22279.pdf", estimateRole: "carrier" as const, text: `Written By: JOHN DOE, License Number: 5\n${shopFinal.text}` };
    const unmarkedOurs = { ...shopFinal, fileName: "22279 supplement.pdf", estimateRole: "carrier" as const, text: `Written By: DANIEL KRAMER, 2\n${shopFinal.text}` };
    expect(selectComparisonCounterpart([insuredIa, unmarkedOurs], { sourceParty: "shop" }).unidentified.length).toBe(2);
    // A bare "appraiser" is a weak mark: against a later brand-named file the run is unsettled.
    const bare = { ...sor, fileName: "Appraiser 22279.pdf", estimateRole: "carrier" as const, text: `Written By: MONICA ROE, License Number: 271128\n${sorText}` };
    const laterBrand = { ...shopFinal, fileName: "USAA 22279 Final.pdf", estimateRole: "carrier" as const };
    expect(selectComparisonCounterpart([bare, laterBrand], { sourceParty: "shop" }).unidentified.length).toBe(2);
    // Printed after the SOR, it is still set aside, never called theirs; it may
    // be the insurer's later version (R13), so the run is not settled.
    const later = { ...ia, text: `Written By: JOHN DOE, 1\n${shopFinal.text}` };
    const sorNamed = { ...sor, estimateRole: "carrier" as const };
    const afterSor = selectComparisonCounterpart([later, sorNamed], { sourceParty: "shop" });
    expect(afterSor.counterpart).toBe(sorNamed);
    expect(afterSor.unidentified.length).toBe(2);
    // Only another party's appraisers on the case: nothing is the insurer's.
    const second = { ...ia, fileName: "Insured's Appraiser 22279.pdf" };
    expect(selectComparisonCounterpart([later, second], { sourceParty: "shop" }).unidentified.length).toBe(2);
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

/*
 * Round 10 of the adversarial review hunted every way left for an estimate
 * that is not the insurer's to be called "Their estimate":
 *   #1 our later version renamed after the insurer ("USAA 22279 Final.pdf")
 *      beside a brand-named SOR, with a second estimator, an OCR-misread
 *      estimator or none printed: two equal brand marks, settled by the
 *      later print date;
 *   #2 our version named for its recipient ("sent to insurance", "post SOR");
 *   #4 another party's appraiser or an umpire's award under the insurer's brand;
 *   #5 a bare "appraiser" name tied with an insurer phrase in the SOR's text;
 *   #6 an insurer word in another party's name ("vs carrier", "Public adjuster").
 * #3 and #7 (a lone comparison) are pinned on the builder below. Each case
 * now picks the insurer's estimate or refuses with the reason.
 */
describe("R10 — what an estimate prints outranks what its file is called", () => {
  // Synthetic identifiers in the RO 22279 shapes: the shop's text layer prints
  // the header labels together and their values after them; the SOR prints
  // its Workfile ID inline and no Federal ID.
  const ourHeader = "Workfile ID:\nFederal ID:\na1b2c3d4\n12-3456789";
  const sourceText = `${ourHeader}\nWritten By: JANE ROE, 739698\nPreliminary Supplement 1 with Summary`;
  const ourTotals = ["Preliminary Estimate", "10/1/2026 6:10:33 PM 300060 Page 1", "ESTIMATE TOTALS", "Subtotal 5,350.68", "Sales Tax $ 5,350.68 @ 6.0000 % 321.04", "Grand Total 5,671.72"];
  const ours = (fileName: string, writtenBy: string, printed = true) => ({
    fileName,
    estimateRole: "carrier" as const,
    text: [printed ? ourHeader : "", writtenBy, ...ourTotals].filter(Boolean).join("\n"),
  });
  const theirs = (fileName: string, workfile = "Phone: (800) 000-0000 Workfile ID: 9f8e7d6c") => ({
    fileName,
    estimateRole: "carrier" as const,
    text: ["USAA CASUALTY INSURANCE COMPANY", workfile, "Written By: MONICA ROE, License Number: 271128, 9/23/2026 9:49:27 AM", "USAA approved estimate", sorText].filter(Boolean).join("\n"),
  });
  // Another party's licensed appraiser, printed after the SOR.
  const otherAppraiser = (fileName: string) => ours(fileName, "Written By: JOHN DOE, License Number: 5", false);

  it("reads the CCC workfile and the writer's Federal ID in every printed layout", () => {
    for (const text of [
      "Workfile ID:\nFederal ID:\na1b2c3d4\n12-3456789",
      "                     Workfile ID:                 a1b2c3d4\n   example.com      Federal ID:                12-3456789",
      "Workfile ID: Federal ID: a1b2c3d4 12-3456789",
    ]) {
      expect(readPrintedWorkfileId(text)).toBe("a1b2c3d4");
      expect(readPrintedFederalId(text)).toBe("123456789");
    }
    expect(readPrintedWorkfileId("Phone: (800) 000-0000 Workfile ID: 9f8e7d6c")).toBe("9f8e7d6c");
    expect(readPrintedWorkfileId("Workfile ID:\na1b2c3d4\nPhone: 1")).toBe("a1b2c3d4");
    // OCR reads 0 as O and 1 as l: still the same workfile.
    expect(readPrintedWorkfileId("Workfile ID: 9f8e7d6O")).toBe(readPrintedWorkfileId("Workfile ID: 9f8e7d60"));
    expect(readPrintedWorkfileId("Workfile ID: a1b2c3d4")).toBe(readPrintedWorkfileId("Workfile ID: alb2c3d4"));
    // A label word read as the value, a redaction or a placeholder is no identifier.
    for (const blank of ["Workfile ID:\nFederal ID:\n[REDACTED]\n[REDACTED]", "Workfile ID: Federal ID:", "Workfile ID: REDACTED", "Workfile ID: 00000000", "Workfile ID: XXXXXXXX", ""]) {
      expect(readPrintedWorkfileId(blank)).toBeNull();
    }
    // A Federal ID printed away from the writer's header (a repair facility block) is not the writer's.
    expect(readPrintedFederalId("Workfile ID: 9f8e7d6c\nInsured: X\nOwner: Y\nRepair Facility: Z\nFederal ID: 12-3456789")).toBeNull();
    expect(samePrintedParty(sourceText, ours("a.pdf", "").text)).toBe("Workfile ID");
    expect(samePrintedParty(sourceText, ours("a.pdf", "Written By: JANE ROE, 739698").text)).toBe("estimator");
    expect(samePrintedParty(sourceText, `Workfile ID: e5f6a7b8\nFederal ID: 12-3456789`)).toBe("Federal ID");
    expect(samePrintedParty(sourceText, theirs("b.pdf").text)).toBeNull();
    // Our header under another writer's name, licensed or not, is no proof
    // either way: our second estimator's version, or the insurer's estimate
    // printed from our own system. A redacted writer cannot conflict, so our
    // header stands.
    for (const writtenBy of ["MONICA ROE, License Number: 271128", "MONICA ROE, 9/23/2026 9:49:27 AM", "MONICA ROE, Llcense Number: 271128"]) {
      const assignment = `${ourHeader}\nWritten By: ${writtenBy}\nEstimate of Record`;
      expect(samePrintedParty(sourceText, assignment)).toBeNull();
      expect(printedPartyConflict(sourceText, assignment)).toBe("Workfile ID");
    }
    expect(samePrintedParty(sourceText, `${ourHeader}\nWritten By: [REDACTED], License Number: 271128\nEstimate of Record`)).toBe("Workfile ID");
    expect(printedPartyConflict(sourceText, theirs("b.pdf").text)).toBeNull();
  });

  it("reads the header as OCR prints it, and a stacked header by the label each value belongs to", () => {
    for (const label of ["Workfile lD:", "Workfile 1D:", "Workfile |D:", "Workflle ID:"]) {
      expect(readPrintedWorkfileId(`${label} a1b2c3d4\n  example.com   Federal ID: 12-3456789`)).toBe("a1b2c3d4");
      expect(readPrintedFederalId(`${label} a1b2c3d4\n  example.com   Federal ID: 12-3456789`)).toBe("123456789");
    }
    for (const federal of ["Federal ID: 12-345O789", "Federal ID: 12 3450789", "Federal lD: 12-3450789"]) {
      expect(readPrintedFederalId(`Workfile ID: a1b2c3d4\n${federal}`)).toBe("123450789");
    }
    // "Claim #:" stacked above "Workfile ID:": the first value is the claim's.
    expect(readPrintedWorkfileId("Phone: 1\nClaim #:\nWorkfile ID:\n0712345678\nf961e3f1\nSupplement of Record 5")).toBe("f961e3f1");
    expect(readPrintedWorkfileId("Claim #:\nWorkfile ID:\n000812092088B03\nf961e3f1")).toBe("f961e3f1");
    // A Mitchell shop print has no Workfile ID; its letterhead block prints the Tax ID.
    expect(readPrintedFederalId("Conestoga Collision\n1 Example St\nTax ID: 123456789\nEstimate ID\n29508501")).toBe("123456789");
    // An OCR'd name reads as its letters, and I/L is no difference.
    expect(sameEstimator("Written By: JANE ROE, 1", "Written By: JANE R0E, 1")).toBe(true);
    expect(sameEstimator("Written By: VINCENT MENICHETTI, 1", "Written By: VINCENT MENICHETTl, 1")).toBe(true);
    expect(sameEstimator("Written By: JANE ROE, 1", "Written By: JOHN DOE, 1")).toBe(false);
  });

  it("our later version renamed after the insurer is never theirs, whoever is printed as its writer (#1)", () => {
    // An OCR misread of ours is our estimator. None printed, or a second
    // estimator, under our workfile on a preliminary print: our own draft (an
    // insurer sends its committed record). Ours either way; the SOR is compared.
    for (const [writtenBy, reason, settled] of [
      ["Written By: JANE R0E, 739698", "it prints the same estimator as the annotated estimate, so it is the same party's", true],
      ["", "it prints the same Workfile ID as the annotated estimate, so it is the same party's", true],
      ["Written By: DANIEL KRAMER, 739699", "it prints the same Workfile ID as the annotated estimate, so it is the same party's", true],
    ] as const) {
      const renamed = ours("USAA 22279 Final.pdf", writtenBy);
      for (const sorName of ["USAA 22279 Supplement 1.pdf", "USAA 22279.pdf", "UsaaSupplement1.pdf"]) {
        const sor = theirs(sorName);
        for (const candidates of [[renamed, sor], [sor, renamed]]) {
          const selection = selectComparisonCounterpart(candidates, { sourceParty: "shop", sourceText });
          expect(selection.counterpart).toBe(sor);
          expect(selection.unidentified.length).toBe(settled ? 0 : 2);
          if (settled) expect(describeExcludedComparisons(selection)).toContain(`USAA 22279 Final.pdf (${reason}`);
        }
      }
    }
  });

  it("equal weak marks tied by nothing printed never settle on the later print date (#1)", () => {
    // A platform that prints no workfile: nothing shows which brand-named estimate is the insurer's.
    const renamed = ours("USAA 22279 Final.pdf", "Written By: DANIEL KRAMER, 739699", false);
    const sor = theirs("USAA 22279 Supplement 1.pdf", "");
    for (const candidates of [[renamed, sor], [sor, renamed]]) {
      const selection = selectComparisonCounterpart(candidates, { sourceParty: "shop", sourceText });
      expect(selection.unidentified.map((candidate) => candidate.fileName).sort()).toEqual(["USAA 22279 Final.pdf", "USAA 22279 Supplement 1.pdf"]);
    }
    // The insurer's own versions tied by their workfile still settle on the latest.
    const record = { ...theirs("USAA estimate 22279.pdf"), text: theirs("").text.replace(/Supplement of Record 1 with Summary/g, "Estimate of Record").replace(/Written By: [^\n]*\n/, "") };
    const supplement = theirs("USAA 22279 Supplement 1.pdf");
    for (const candidates of [[record, supplement], [supplement, record]]) {
      expect(selectComparisonCounterpart(candidates, { sourceParty: "shop", sourceText })).toMatchObject({ counterpart: supplement, unidentified: [] });
    }
  });

  it("a name that only addresses the insurer marks nothing: our file 'sent to insurance' never outranks the SOR (#2)", () => {
    for (const name of [
      "22279 Supplement sent to insurance.pdf",
      "22279 estimate for insurance.pdf",
      "Supplement to adjuster 22279.pdf",
      "22279 Supp request to carrier.pdf",
      "22279 post SOR supplement.pdf",
      "Supplement after SOR 1.pdf",
      "22279 SOR response.pdf",
      "22279 vs SOR.pdf",
      "22279 Supplement for USAA.pdf",
    ]) {
      // Nothing printed ties it to ours here: its name alone is weighed.
      const shopFile = ours(name, "Written By: DANIEL KRAMER, 739699", false);
      const sor = theirs("SOR-1 22279.pdf");
      for (const candidates of [[shopFile, sor], [sor, shopFile]]) {
        expect(selectComparisonCounterpart(candidates, { sourceParty: "shop", sourceText })).toMatchObject({ counterpart: sor, unidentified: [] });
      }
    }
  });

  it("another party's appraiser, an umpire's award or a public adjuster is never the insurer's, whatever brand or insurer word its name carries (#4, #6)", () => {
    for (const [otherName, sorName] of [
      ["USAA 22279 Insured Appraiser.pdf", "USAA 22279.pdf"],
      ["USAA claim 22279 - insured appraiser estimate.pdf", "USAA Supplement 1 22279.pdf"],
      ["USAA 22279 Owner Appraiser.pdf", "USAA 22279.pdf"],
      ["USAA 22279 Umpire Award.pdf", "USAA 22279 Estimate.pdf"],
      ["Insured appraiser vs carrier 22279.pdf", "SOR 1 22279.pdf"],
      ["Insured appraiser re SOR 22279.pdf", "USAA SOR 22279.pdf"],
      ["Public adjuster 22279.pdf", "Carrier 22279.pdf"],
      ["Appraiser for insured 22279.pdf", "SOR 1 22279.pdf"],
    ]) {
      const other = otherAppraiser(otherName);
      const sor = theirs(sorName);
      for (const candidates of [[other, sor], [sor, other]]) {
        const selection = selectComparisonCounterpart(candidates, { sourceParty: "shop", sourceText });
        expect(selection).toMatchObject({ counterpart: sor, unidentified: [] });
        expect(describeExcludedComparisons(selection)).toContain(`${otherName} (its name marks it as an appraiser other than the insurer's)`);
      }
    }
    // Only other parties' estimates on the case: nothing is the insurer's.
    const onlyOthers = [otherAppraiser("Independent appraiser 22279.pdf"), otherAppraiser("USAA 22279 Insured Appraiser.pdf")];
    expect(selectComparisonCounterpart(onlyOthers, { sourceParty: "shop", sourceText }).unidentified.length).toBe(2);
    // "Independent" is either side's appraiser: an insurer mark in the same name keeps it theirs.
    expect(namesAnotherPartysEstimate("USAA SOR 1 - Independent Appraiser.pdf")).toBe(false);
    expect(namesAnotherPartysEstimate("USAA IA appraiser estimate.pdf")).toBe(false);
    expect(namesAnotherPartysEstimate("Independent appraiser vs carrier 22279.pdf")).toBe(true);
    expect(namesAnotherPartysEstimate("SOR-1_22279.pdf")).toBe(false);
  });

  it("a bare 'appraiser' and an insurer phrase are both weak: side by side, or beside another party's appraiser, nothing settles whose (#5)", () => {
    // The SOR marked only by its text, another party's appraiser by a bare "appraiser", printed later.
    for (const [appraiserName, sorName] of [
      ["Appraiser estimate 22279.pdf", "22279 Supplement 1.pdf"],
      ["Hired appraiser 22279.pdf", "Desk review 22279.pdf"],
    ]) {
      const appraiser = otherAppraiser(appraiserName);
      const sor = theirs(sorName);
      for (const candidates of [[appraiser, sor], [sor, appraiser]]) {
        expect(selectComparisonCounterpart(candidates, { sourceParty: "shop", sourceText }).unidentified.map((c) => c.fileName).sort()).toEqual([appraiserName, sorName].sort());
      }
    }
    // Our own unprinted version named "for appraiser" beside the SOR marked only by its text.
    const forAppraiser = ours("22279 for appraiser.pdf", "Written By: DANIEL KRAMER, 739699", false);
    expect(selectComparisonCounterpart([theirs("Supplement of Record 1.pdf"), forAppraiser], { sourceParty: "shop", sourceText }).unidentified.length).toBe(2);
    // The insurer's IA set aside by its name leaves a bare "appraiser" alone: unsettled, never theirs.
    const ia = theirs("Independent appraiser 22279.pdf");
    const doe = otherAppraiser("Appraiser J Doe 22279.pdf");
    // Nor is our own version, unprinted and named after the insurer, shown to be theirs beside it.
    const ourUnprinted = ours("USAA 22279 Final.pdf", "Written By: DANIEL KRAMER, 739699", false);
    for (const other of [doe, ourUnprinted]) {
      for (const candidates of [[ia, other], [other, ia]]) {
        expect(selectComparisonCounterpart(candidates, { sourceParty: "shop", sourceText }).unidentified.length).toBe(2);
      }
    }
  });
});

/*
 * Round 11 reviewed the round-10 fix the same way and found what it still
 * let through or newly refused:
 *   - an insurer word kept after a two-word reference ("request to USAA
 *     adjuster", "Response to USAA SOR 1"), with two plainly marked files
 *     settled on print date;
 *   - the insurer's revision named for its author ("Carrier response",
 *     "Estimate per adjuster") dropped for the older SOR;
 *   - insurer estimate + supplement pairs refused for printing no shared
 *     workfile (Mitchell);
 *   - the insurer's estimate printed from our own system called ours;
 *   - OCR-misread header labels losing both identifiers;
 *   - reversed or abbreviated appraiser names ("Appraiser - Insured",
 *     "Insd appraiser").
 */
describe("R11 — ties by print at every tier, references by what they name", () => {
  const ourHeader = "Workfile ID:\nFederal ID:\na1b2c3d4\n12-3456789";
  const sourceText = `${ourHeader}\nWritten By: JANE ROE, 739698\nPreliminary Supplement 1 with Summary`;
  const ourTotals = ["Preliminary Estimate", "10/1/2026 6:10:33 PM 300060 Page 1", "ESTIMATE TOTALS", "Subtotal 5,350.68", "Sales Tax $ 5,350.68 @ 6.0000 % 321.04", "Grand Total 5,671.72"];
  // Our version on a platform that prints neither our workfile nor our estimator.
  const ourUnprinted = (fileName: string) => ({ fileName, estimateRole: "carrier" as const, text: ["Conestoga Collision", "Estimator: DANIEL KRAMER", ...ourTotals].join("\n") });
  const insurer = (fileName: string, { version = 1, workfile = "9f8e7d6c", writtenBy = "MONICA ROE, License Number: 271128", printed = "9/23/2026 9:49:27 AM", letterhead = "USAA CASUALTY INSURANCE COMPANY", claim = "0123456789012" } = {}) => ({
    fileName,
    estimateRole: "carrier" as const,
    text: [letterhead, `Claim #: ${claim}`, `Phone: (800) 000-0000 Workfile ID: ${workfile}`, `Written By: ${writtenBy}, ${printed}`, sorText.replace(/Supplement of Record 1 with Summary/g, `Supplement of Record ${version} with Summary`)].join("\n"),
  });
  const pick = (candidates: Array<{ fileName: string; text: string; estimateRole: "carrier" }>) => selectComparisonCounterpart(candidates, { sourceParty: "shop", sourceText });

  it("a reference to the insurer, however many words, marks nothing; our file never outranks the SOR", () => {
    for (const name of [
      "Supplement request to USAA adjuster.pdf",
      "Response to USAA SOR 1.pdf",
      "22279 vs USAA SOR.pdf",
      "Supp sent to Geico adjuster.pdf",
      "Rebuttal to the insurance SOR.pdf",
      "Supplement for insurance adjuster.pdf",
      "22279 supplement request - carrier.pdf",
      "Supplement 2 with SOR changes.pdf",
      "supp to ins adjuster.pdf",
      "22279 Supplement post USAA SOR.pdf",
    ]) {
      const ours = ourUnprinted(name);
      for (const candidates of [[ours, insurer("SOR-1 22279.pdf")], [insurer("SOR-1 22279.pdf"), ours]]) {
        expect(pick(candidates)).toMatchObject({ counterpart: { fileName: "SOR-1 22279.pdf" }, unidentified: [] });
      }
      // Beside a brand-only name our unmarked file leaves the run unsettled
      // (an OCR'd SOR may carry no mark), but it is never the one compared.
      for (const candidates of [[ours, insurer("USAA 22279.pdf")], [insurer("USAA 22279.pdf"), ours]]) {
        expect(pick(candidates).counterpart?.fileName).toBe("USAA 22279.pdf");
      }
    }
  });

  it("two plainly marked estimates are one party's only when their prints tie them", () => {
    // "SOR + supplement" keeps its mark, so it ties with the SOR on its name:
    // nothing printed settles which is the insurer's.
    const ambiguous = ourUnprinted("22279 SOR + supplement.pdf");
    const sor = insurer("SOR-1 22279.pdf");
    for (const candidates of [[ambiguous, sor], [sor, ambiguous]]) {
      expect(pick(candidates).unidentified.map((c) => c.fileName).sort()).toEqual(["22279 SOR + supplement.pdf", "SOR-1 22279.pdf"]);
    }
    // The insurer's two versions in one workfile, or under one letterhead, settle on the latest.
    const second = insurer("SOR-2 22279.pdf", { version: 2, writtenBy: "DESK REVIEWER, License Number: 5" });
    const otherWorkfile = insurer("SOR-2 22279.pdf", { version: 2, workfile: "1a2b3c4d", writtenBy: "DESK REVIEWER, License Number: 5" });
    for (const revision of [second, otherWorkfile]) {
      for (const candidates of [[sor, revision], [revision, sor]]) {
        expect(pick(candidates)).toMatchObject({ counterpart: revision, unidentified: [] });
      }
    }
  });

  it("the insurer's revision named for its author is compared, never dropped for the older SOR", () => {
    for (const name of ["Carrier response 22279.pdf", "Insurance response to supplement 22279.pdf", "Adjuster reply 22279.pdf", "USAA response 22279.pdf", "Estimate per adjuster 22279.pdf", "Supplement 2 to SOR 22279.pdf", "RE USAA estimate 22279.pdf"]) {
      const revision = insurer(name, { version: 2, printed: "9/30/2026 9:00:00 AM" });
      const sor = insurer("SOR-1 22279.pdf");
      for (const candidates of [[sor, revision], [revision, sor]]) {
        expect(pick(candidates)).toMatchObject({ counterpart: revision, unidentified: [] });
      }
    }
    // Under another workfile, writer and letterhead, a plainly marked revision is not shown to be one party's with the SOR.
    const unrelated = insurer("Carrier response 22279.pdf", { version: 2, workfile: "1a2b3c4d", writtenBy: "KEVIN FIELD, License Number: 7", letterhead: "FIELD APPRAISAL GROUP" });
    expect(pick([insurer("SOR-1 22279.pdf"), unrelated]).unidentified.length).toBe(2);
  });

  it("the insurer's estimate printed from our own system is neither ours nor settled as theirs", () => {
    const assignment = { fileName: "SOR-1 22279.pdf", estimateRole: "carrier" as const, text: [ourHeader, "Written By: MONICA ROE, 9/23/2026 9:49:27 AM", sorText].join("\n") };
    const ourOther = { fileName: "22279 final.pdf", estimateRole: "carrier" as const, text: [ourHeader, "Written By: JANE ROE, 739698", ...ourTotals].join("\n") };
    for (const candidates of [[assignment, ourOther], [ourOther, assignment]]) {
      const selection = pick(candidates);
      expect(selection.counterpart).toBe(assignment);
      expect(selection.unidentified).toEqual([assignment]);
    }
    // Beside a bare "appraiser" file, that file is not settled as theirs either.
    const doe = { fileName: "Appraiser J Doe 22279.pdf", estimateRole: "carrier" as const, text: ["DOE APPRAISALS LLC", "Workfile ID: 7c7c1e2a", "Written By: JOHN DOE, License Number: 5", ...ourTotals].join("\n") };
    expect(pick([assignment, doe]).unidentified.length).toBe(2);
  });

  it("names another party's appraiser however the name is ordered or abbreviated, and an insurer-hired one as the insurer's", () => {
    for (const name of ["Insd appraiser 22279.pdf", "Appraiser - Insured 22279.pdf", "Appraiser (owner) 22279.pdf", "Appraiser hired by insured 22279.pdf", "Appraiser estimate for insured 22279.pdf", "Indep appraiser 22279.pdf"]) {
      expect(namesAnotherPartysEstimate(name)).toBe(true);
    }
    for (const name of [
      "Independent Appraiser for USAA 22279.pdf",
      "Staff appraiser for the insured.pdf",
      "Insurance appraiser for insured.pdf",
      "USAA appraiser for owner.pdf",
      "State Farm appraiser estimate for insured.pdf",
      "Appraiser estimate - insured copy.pdf",
      // In a liability claim the claimant's vehicle is appraised by the insurer.
      "Clmt appraiser 22279.pdf",
    ]) {
      expect(namesAnotherPartysEstimate(name)).toBe(false);
    }
  });

  it("another party's own revision, tied to it by print, is set aside with it", () => {
    const ia = { fileName: "Independent appraiser 22279.pdf", estimateRole: "carrier" as const, text: ["DOE APPRAISALS LLC", "Workfile ID: 7c7c1e2a", "Written By: JOHN DOE, License Number: 5", "9/25/2026 9:00:00 AM", ...ourTotals.slice(2)].join("\n") };
    const revised = { ...ia, fileName: "USAA 22279 revised.pdf", text: ["DOE APPRAISALS LLC", "Workfile ID: 7c7c1e2a", "Written By: JOHN DOE, License Number: 5", ...ourTotals].join("\n") };
    for (const candidates of [[ia, revised], [revised, ia]]) {
      const selection = pick(candidates);
      expect(selection.unidentified.length).toBe(2);
      // Only set-aside estimates are left, so the one compared says it is set aside.
      expect(describeExcludedComparisons(selection)).toMatch(
        /^Compared against USAA 22279 revised\.pdf only, though it is itself set aside \(it prints the same Workfile ID as Independent appraiser 22279\.pdf, which is set aside\)\. Not compared: Independent appraiser 22279\.pdf/
      );
    }
  });

  it("beside a set-aside independent appraiser, a brand-named estimate is never settled as theirs, whatever letterhead it prints", () => {
    const ia = { fileName: "Independent appraiser 22279.pdf", estimateRole: "carrier" as const, text: ["DOE APPRAISALS LLC", "Written By: JOHN DOE, License Number: 5", ...ourTotals].join("\n") };
    // Our print shows no workfile (a header that did not extract), and theirs shows none either.
    const noWorkfile = (text: string) => text.replace(/Phone: \(800\) 000-0000 Workfile ID: 9f8e7d6c\n/, "");
    const brand = { ...insurer("USAA 22279.pdf"), text: noWorkfile(insurer("USAA 22279.pdf").text).replace(/Written By: [^\n]*\n/, "") };
    // R13: a letterhead is no proof of the insurer (a cover letter's addressee
    // reads the same), and the IA may have been the insurer's own.
    for (const candidates of [[ia, brand], [brand, ia]]) {
      expect(selectComparisonCounterpart(candidates, { sourceParty: "shop", sourceText: "Written By: JANE ROE, 739698" }).unidentified.length).toBe(2);
    }
  });
});

/*
 * Round 12 reviewed the round-11 fix and found what its letterhead tie and
 * its "printed not ours" exemption let through: an insurer letterhead is a
 * whole company's (a prior claim's estimate joined the SOR); a shop named
 * "Progressive Auto Body" read as an insurer; an outside appraiser's print is
 * "not ours" without being the insurer's; an IA writing on the insurer's
 * profile pulled the SOR aside with it; the insurer's supplement printed from
 * our system was dropped for the older SOR; and more appraiser name shapes.
 */
describe("R12 — a company letterhead is not a claim, and not ours is not theirs", () => {
  const ourHeader = "Workfile ID:\nFederal ID:\na1b2c3d4\n12-3456789";
  const sourceText = `conestogacollision.com\n${ourHeader}\nWritten By: JANE ROE, 739698\nPreliminary Supplement 1 with Summary`;
  const totals = ["Preliminary Estimate", "10/1/2026 6:10:33 PM 300060 Page 1", "ESTIMATE TOTALS", "Subtotal 5,350.68", "Sales Tax $ 5,350.68 @ 6.0000 % 321.04", "Grand Total 5,671.72"];
  const insurer = (fileName: string, { version = 1, workfile = "9f8e7d6c", writtenBy = "MONICA ROE, License Number: 271128", printed = "9/23/2026 9:49:27 AM", letterhead = "USAA CASUALTY INSURANCE COMPANY", claim = "0123456789012" } = {}) => ({
    fileName,
    estimateRole: "carrier" as const,
    text: [letterhead, `Claim #: ${claim}`, `Phone: (800) 000-0000 Workfile ID: ${workfile}`, `Written By: ${writtenBy}, ${printed}`, sorText.replace(/Supplement of Record 1 with Summary/g, `Supplement of Record ${version} with Summary`)].join("\n"),
  });
  const doe = (fileName: string, printed = "10/1/2026 6:10:33 PM") => ({
    fileName,
    estimateRole: "carrier" as const,
    text: ["DOE AUTO APPRAISALS LLC", "Workfile ID: 7c7c1e2a", "Written By: JOHN DOE, License Number: 5", ...totals.map((line) => line.replace("10/1/2026 6:10:33 PM", printed))].join("\n"),
  });
  // The insurer's estimate printed from our own system: our header, their writer.
  const assignment = (fileName: string, writtenBy = "MONICA ROE") => ({ fileName, estimateRole: "carrier" as const, text: ["conestogacollision.com", ourHeader, `Written By: ${writtenBy}, 9/23/2026 9:49:27 AM`, sorText].join("\n") });
  const pick = (candidates: Array<{ fileName: string; text: string; estimateRole: "carrier" }>) => selectComparisonCounterpart(candidates, { sourceParty: "shop", sourceText });
  const orders = <C,>(a: C, b: C) => [[a, b], [b, a]];

  it("another claim's estimate from the same insurer never joins the SOR on its letterhead", () => {
    const sor = insurer("SOR-1 22279.pdf");
    const prior = insurer("Prior loss estimate 2025.pdf", { version: 2, workfile: "5d0c4e21", writtenBy: "KEVIN FIELD, License Number: 384512", printed: "3/14/2025 9:00:00 AM", claim: "0123456789099" });
    for (const candidates of orders(sor, prior)) {
      const selection = pick(candidates);
      expect(selection.counterpart === prior && selection.unidentified.length === 0).toBe(false);
    }
    // The same claim under the same letterhead is one writer's: settled on the latest.
    const desk = insurer("SOR-2 22279.pdf", { version: 2, workfile: "1a2b3c4d", writtenBy: "DESK REVIEWER, License Number: 6" });
    for (const candidates of orders(sor, desk)) expect(pick(candidates)).toMatchObject({ counterpart: desk, unidentified: [] });
  });

  it("printing something not ours does not make an outside appraiser the insurer's", () => {
    // The SOR printed from our system is set aside; an outside appraiser's brand-named file is not settled as theirs.
    for (const name of ["USAA 22279 Appraiser.pdf", "USAA 22279 J Doe.pdf"]) {
      for (const candidates of orders(assignment("SOR-1 22279.pdf"), doe(name))) {
        expect(pick(candidates).unidentified.length).toBe(2);
      }
    }
    // Its revision joining it by print does not lift the bare "appraiser" guard.
    const revised = doe("22279 revised.pdf", "10/2/2026 9:00:00 AM");
    for (const candidates of [[assignment("SOR-1 22279.pdf"), doe("Appraiser J Doe 22279.pdf"), revised], [revised, doe("Appraiser J Doe 22279.pdf"), assignment("SOR-1 22279.pdf")]]) {
      expect(pick(candidates).unidentified.length).toBe(3);
    }
    // A shop named for a brand word is not an insurer's letterhead.
    for (const shopName of ["Progressive Auto Body", "Nationwide Collision Center", "Farmers Collision & Glass"]) {
      const shopSource = sourceText.replace("conestogacollision.com", shopName);
      const second = { fileName: "22279 supplement.pdf", estimateRole: "carrier" as const, text: [shopName, ourHeader, "Written By: DANIEL KRAMER, 739699", ...totals].join("\n") };
      const unprinted = { fileName: "USAA 22279 Final estimate.pdf", estimateRole: "carrier" as const, text: [shopName, "Written By: DANIEL KRAMER, 739699", ...totals].join("\n") };
      // Both are our own preliminary prints: ours by our header and letterhead, never theirs.
      expect(samePrintedParty(shopSource, second.text)).toBe("Workfile ID");
      expect(samePrintedParty(shopSource, unprinted.text)).toBe("letterhead");
    }
  });

  it("an independent appraiser writing on the insurer's profile is the insurer's, and never takes the SOR aside", () => {
    const ia = insurer("Independent appraiser 22279.pdf", { version: 0, writtenBy: "PAT SMITH, License Number: 8", printed: "9/16/2026 9:00:00 AM" });
    const ia0 = { ...ia, text: ia.text.replace(/Supplement of Record 0 with Summary/g, "Estimate of Record") };
    const sor = insurer("SOR-1 22279.pdf");
    for (const candidates of orders(ia0, sor)) expect(pick(candidates)).toMatchObject({ counterpart: sor, unidentified: [] });
    // Beside our own SOR-named file that nothing ties to us: unsettled, never ours.
    const ours = { fileName: "SOR 22279 - our supplement.pdf", estimateRole: "carrier" as const, text: ["conestogacollision.com", "Written By: DANIEL KRAMER, 739699", ...totals].join("\n") };
    for (const candidates of [[ia0, sor, ours], [ours, sor, ia0]]) {
      const selection = pick(candidates);
      expect(selection.counterpart === ours && selection.unidentified.length === 0).toBe(false);
    }
    // Alone, nothing ties it to a file named as the insurer's: its name is refused.
    expect(namesAnotherPartysEstimate(ia0.fileName)).toBe(true);
  });

  it("the insurer's later version printed from our system joins its SOR by the licensed appraiser", () => {
    const sor1 = insurer("SOR 1 22279.pdf");
    const sor2 = { fileName: "SOR 2 22279.pdf", estimateRole: "carrier" as const, text: ["conestogacollision.com", ourHeader, "Written By: MONICA ROE, License Number: 271128, 9/30/2026 9:00:00 AM", sorText.replace(/Supplement of Record 1 with Summary/g, "Supplement of Record 2 with Summary")].join("\n") };
    for (const candidates of orders(sor1, sor2)) {
      // Compared against the later version; the gate then refuses it for printing our workfile.
      expect(pick(candidates)).toMatchObject({ counterpart: sor2, unidentified: [] });
    }
  });

  it("one print read two ways, or three versions chained by print, settle in any upload order", () => {
    const mitchell = readFileSync(path.join(FIXTURE_DIR, "../frk1b-mitchell-text.txt"), "utf8");
    const textLayer = { fileName: "SOR 1.pdf", estimateRole: "carrier" as const, text: mitchell };
    const ocr = { fileName: "SOR 2.pdf", estimateRole: "carrier" as const, text: `[[OCR text recovered]]\n===== Page 1 =====\n${mitchell.replace(/^Progressive Specialty Insurance CoProgressive Specialty Insurance Co/, "Progressive Specialty Insurance Co")}` };
    expect(readPrintedLetterhead(textLayer.text)).toBe(readPrintedLetterhead(ocr.text));
    const mitchellSource = readFileSync(path.join(FIXTURE_DIR, "../frk2-mitchell-text.txt"), "utf8");
    for (const candidates of orders(textLayer, ocr)) {
      // One print of one claim: settled (it prints no version or date that orders the two).
      expect(selectComparisonCounterpart(candidates, { sourceParty: "shop", sourceText: mitchellSource }).unidentified).toEqual([]);
    }
    const eor = { ...insurer("SOR EOR 22279.pdf", { writtenBy: "KEVIN FIELD, License Number: 7", printed: "9/16/2026 9:00:00 AM" }) };
    const record = { ...eor, text: eor.text.replace(/Supplement of Record 1 with Summary/g, "Estimate of Record") };
    const first = insurer("SOR 1 22279.pdf");
    const second = insurer("SOR 2 22279.pdf", { version: 2, workfile: "9f8e7d6e", letterhead: "USAA CASUALTY lNSURANCE COMPANY", printed: "9/30/2026 9:00:00 AM" });
    for (const candidates of [[record, first, second], [second, first, record], [record, second, first], [first, record, second], [second, record, first], [first, second, record]]) {
      expect(pick(candidates)).toMatchObject({ counterpart: second, unidentified: [] });
    }
  });

  it("a letterhead is the print's own first line: never a header label, an amount or a letter's addressee", () => {
    // A CCC print whose letterhead is an image starts with its header labels.
    expect(readPrintedLetterhead("Workfile ID:\nFederal ID:\n7c7c1e2a\n98-7654321\nClaim #: 0123456789012")).toBeNull();
    expect(readPrintedLetterhead("Preliminary Estimate\nClaim #: 00-0000000-01\nNet Cost of Repairs $28,840.26")).toBeNull();
    // R13: a letter's inside address is not its writer's letterhead.
    expect(readPrintedLetterhead("October 1, 2026\nUSAA Casualty Insurance Company\nAttn: Claims Department\nRe: Claim # 0123456789012")).toBeNull();
    expect(readPrintedLetterhead("USAA Casualty Insurance Company\nAttn: Claims Department\nDear Ms. Roe,")).toBeNull();
    // OCR sets a header label on the letterhead's row, or reads I as l.
    expect(readPrintedLetterhead("Progressive Specialty Insurance Co Estimate ID\n25-1")).toBe(readPrintedLetterhead("Progressive Specialty lnsurance Co\nEstimate ID"));
  });

  it("our own Mitchell versions are ours by our letterhead, however they are named", () => {
    const shop = readFileSync(path.join(FIXTURE_DIR, "../frk2-mitchell-text.txt"), "utf8");
    const untaxed = shop.replace(/^Tax ID:.*\n/m, "");
    expect(readPrintedFederalId(untaxed)).toBeNull();
    for (const name of ["20785 Supplement 1.pdf", "GEICO 20785 Final.pdf"]) {
      expect(samePrintedParty(shop, untaxed)).toBe("letterhead");
      const pair = [
        { fileName: "20785 Supplement 1.pdf", estimateRole: "carrier" as const, text: untaxed },
        { fileName: name === "GEICO 20785 Final.pdf" ? name : "GEICO 20785 Final.pdf", estimateRole: "carrier" as const, text: `${untaxed}\nBLEND NOT ON GEICO ESTIMATE, ADDED` },
      ];
      for (const candidates of orders(pair[0], pair[1])) {
        const selection = selectComparisonCounterpart(candidates, { sourceParty: "shop", sourceText: shop });
        // Both are ours: whichever is compared, the gate refuses it as ours.
        expect(samePrintedParty(shop, selection.counterpart!.text)).toBe("letterhead");
      }
    }
  });

  it("reads appraiser names by whose appraiser they name, not where the file went", () => {
    for (const name of [
      "Appraiser for insured vs USAA 22279.pdf",
      "Appraiser hired by owner re USAA SOR 22279.pdf",
      "USAA 22279 - Appraiser for insured.pdf",
      "USAA claim 22279 appraiser - insured.pdf",
      "USAA 22279 Insured's independent appraiser.pdf",
      "Insured IA estimate 22279.pdf",
      "Owner's IA 22279.pdf",
      "Independent appraiser estimate for USAA claim 22279.pdf",
    ]) {
      expect(namesAnotherPartysEstimate(name)).toBe(true);
    }
    for (const name of [
      "Appraiser estimate from owner.pdf",
      "Appraiser est sent to insured.pdf",
      "Copy to insured - appraiser estimate.pdf",
      "Progressive claimant appraiser estimate.pdf",
      "USAA SOR 3 per award.pdf",
      "SOR 2 post award.pdf",
      "Appraiser report for owner USAA.pdf",
    ]) {
      expect(namesAnotherPartysEstimate(name)).toBe(false);
    }
    // A copy made for the insurer names its recipient.
    for (const name of ["22279 Supplement 2 - Insurance copy.pdf", "22279 Final - adjuster copy.pdf"]) {
      const ours = { fileName: name, estimateRole: "carrier" as const, text: ["conestogacollision.com", "Written By: DANIEL KRAMER, 739699", ...totals].join("\n") };
      for (const candidates of orders(ours, insurer("USAA 22279.pdf"))) expect(pick(candidates).counterpart?.fileName).toBe("USAA 22279.pdf");
    }
  });
});

/*
 * Round 13 found the class behind most earlier rounds: a file left out on
 * grounds that do not rule out the insurer (a print conflict, an unreadable
 * writer under our header, an independent appraiser, another party's name
 * that also marks the insurer) silently promoted an older estimate. Now such
 * a file never lets the run settle on an estimate it may be newer than. It
 * also found a cover letter's addressee read as a letterhead, "from owner's
 * appraiser" read as a recipient, and an insurer's post-award revision set
 * aside for the word "award".
 */
describe("R13 — nothing left out on uncertain grounds may be newer than the one compared", () => {
  const ourHeader = "Workfile ID:\nFederal ID:\na1b2c3d4\n12-3456789";
  const sourceText = `conestogacollision.com\n${ourHeader}\nWritten By: JANE ROE, 739698\nPreliminary Supplement 1 with Summary`;
  const totals = ["Preliminary Estimate", "10/1/2026 6:10:33 PM 300060 Page 1", "ESTIMATE TOTALS", "Subtotal 5,350.68", "Sales Tax $ 5,350.68 @ 6.0000 % 321.04", "Grand Total 5,671.72"];
  const insurer = (fileName: string, { version = 1, workfile = "9f8e7d6c", writtenBy = "Written By: MONICA ROE, License Number: 271128", printed = "9/23/2026 9:49:27 AM", head = ["USAA CASUALTY INSURANCE COMPANY", "Claim #: 0123456789012"] } = {}) => ({
    fileName,
    estimateRole: "carrier" as const,
    text: [...head, `Phone: (800) 000-0000 Workfile ID: ${workfile}`, `${writtenBy}, ${printed}`, sorText.replace(/Supplement of Record 1 with Summary/g, `Supplement of Record ${version} with Summary`)].join("\n"),
  });
  const pick = (candidates: Array<{ fileName: string; text: string; estimateRole: "carrier" }>, source = sourceText) => selectComparisonCounterpart(candidates, { sourceParty: "shop", sourceText: source });
  const orders = <C,>(a: C, b: C) => [[a, b], [b, a]];
  const settledOn = (selection: ReturnType<typeof pick>) => (selection.unidentified.length ? null : selection.counterpart?.fileName);

  it("a cover letter's addressee never makes another party's estimate the insurer's", () => {
    const letter = ["October 1, 2026", "USAA Casualty Insurance Company", "Attn: Claims Department", "P.O. Box 33490", "Re: Claim # 0123456789012", "Dear Ms. Roe,", "Enclosed is our estimate.", "Sincerely,", "John Doe"];
    const doe = (fileName: string) => ({ fileName, estimateRole: "carrier" as const, text: [...letter, "DOE AUTO APPRAISALS LLC", "Workfile ID: 7c7c1e2a", "Written By: JOHN DOE, License Number: 5", ...totals].join("\n") });
    expect(readPrintedLetterhead(doe("x").text)).toBeNull();
    for (const name of ["Independent appraiser 22279.pdf", "22279 Doe estimate.pdf", "Appraiser J Doe 22279.pdf", "USAA 22279 J Doe.pdf"]) {
      for (const candidates of orders(insurer("SOR-1 22279.pdf"), doe(name))) {
        expect(settledOn(pick(candidates))).not.toBe(name);
      }
    }
    // An annotated estimate that opens with the same letter does not make the SOR ours.
    const lettered = `${letter.join("\n")}\n${sourceText}`;
    expect(samePrintedParty(lettered, insurer("SOR-1 22279.pdf").text)).toBeNull();
  });

  it("the insurer's later version under our header, with another writer or none readable, never lets the older SOR settle", () => {
    const sor1 = insurer("SOR-1 22279.pdf");
    const fromOurSystem = (writtenBy: string) => ({
      fileName: "SOR-2 22279.pdf",
      estimateRole: "carrier" as const,
      text: ["conestogacollision.com", ourHeader, `${writtenBy}, 9/30/2026 9:00:00 AM`, sorText.replace(/Supplement of Record 1 with Summary/g, "Supplement of Record 2 with Summary")].join("\n"),
    });
    for (const writtenBy of ["Written By: KEVIN FIELD, License Number: 384512", "Estimator: KEVIN FIELD", "Wrltten By: KEVIN FIELD, License Number: 384512"]) {
      for (const candidates of orders(sor1, fromOurSystem(writtenBy))) {
        expect(settledOn(pick(candidates))).not.toBe("SOR-1 22279.pdf");
      }
    }
    // The same licensed appraiser, its label read as OCR gives it: joined to SOR-1 and compared.
    for (const candidates of orders(sor1, fromOurSystem("Wrltten By: MONICA ROE, License Number: 271128"))) {
      expect(pick(candidates).counterpart?.fileName).toBe("SOR-2 22279.pdf");
    }
  });

  it("the insurer's revision named for an award or an umpire is the insurer's, and is compared", () => {
    for (const name of ["Carrier supplement to award 22279.pdf", "USAA SOR 3 award.pdf", "SOR 3 - award supplement 22279.pdf", "SOR 3 - umpire copy 22279.pdf"]) {
      expect(namesAnotherPartysEstimate(name)).toBe(false);
      const revision = insurer(name, { version: 3, printed: "10/2/2026 9:00:00 AM" });
      for (const candidates of orders(insurer("SOR 2 22279.pdf", { version: 2 }), revision)) {
        expect(pick(candidates)).toMatchObject({ counterpart: revision, unidentified: [] });
      }
    }
    // Named only for the award, it prints the insurer's workfile and appraiser: the insurer's.
    const award = insurer("Umpire award 22279.pdf", { version: 3, printed: "10/2/2026 9:00:00 AM" });
    expect(namesAnotherPartysEstimate(award.fileName)).toBe(true);
    for (const candidates of orders(insurer("SOR 2 22279.pdf", { version: 2 }), award)) {
      expect(pick(candidates)).toMatchObject({ counterpart: award, unidentified: [] });
    }
  });

  it("another party's appraiser named after where the file came from is still that party's", () => {
    for (const name of ["Estimate from owner's appraiser 22279.pdf", "Received from insured's appraiser 22279.pdf", "From owners appraiser 22279.pdf"]) {
      expect(namesAnotherPartysEstimate(name)).toBe(true);
    }
    for (const name of ["Copy to insured - appraiser estimate.pdf", "Appraiser estimate from owner.pdf"]) {
      expect(namesAnotherPartysEstimate(name)).toBe(false);
    }
  });

  it("a repair facility's Federal ID set lower on the insurer's print is not its writer's", () => {
    const sor5 = readFileSync(path.join(FIXTURE_DIR, "../22084/sor5_text.txt"), "utf8");
    const withFacility = sor5.replace(/(\(610\) 644-1000 Evening)/, "$1\nFederal ID:\n27-0822500");
    expect(withFacility).not.toBe(sor5);
    expect(readPrintedFederalId(withFacility)).toBeNull();
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
  const subjectText = "Preliminary Estimate\nClaim #: 00-0000000-01\nNet Cost of Repairs $28,840.26";
  const build = async (
    comparisonEstimateTexts: Parameters<typeof buildAnnotatedCitationDensityEstimatePdf>[0]["comparisonEstimateTexts"],
    sourceText = subjectText
  ) =>
    buildAnnotatedCitationDensityEstimatePdf({
      sourcePdfBytes: await subjectPdf(),
      sourcePdfName: "Shop Final Estimate.pdf",
      sourceDocumentId: "shop-final",
      sourceText,
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

  // R10 #3: a two-estimate upload with no SOR yet; the route guessed "carrier"
  // for our own other version, and its writer differs from ours.
  it("a lone comparison our own print ties to us is never theirs, whatever it is called and whoever is printed as its writer", async () => {
    const header = "Workfile ID:\nFederal ID:\na1b2c3d4\n12-3456789";
    // R11: the label as OCR reads it ("Workfile lD") still ties it.
    for (const ourHeader of [header, header.replace("Workfile ID", "Workfile lD")]) {
      for (const fileName of ["USAA estimate 22279.pdf", "Supplement to adjuster 22279.pdf", "22279 SOR response.pdf"]) {
        const ourSource = `${header}\nWritten By: JANE ROE, 739698\n${subjectText}`;
        // No writer printed: our workfile is the proof.
        const unwritten = await build([{ fileName, sourceDocumentId: "v", estimateRole: "carrier", text: `${ourHeader}\n${shopVersionText}` }], ourSource);
        expect(unwritten.plainSummaryExportId).toBeUndefined();
        expect(unwritten.warnings.join("\n")).toContain(
          `Appraisal Dispute Report not produced: ${fileName} prints the same Workfile ID as our estimate, so it reads as our own estimate, not the insurer's.`
        );
        // A second estimator under our workfile on a preliminary print: our own draft.
        const second = await build([{ fileName, sourceDocumentId: "v", estimateRole: "carrier", text: `${ourHeader}\nWritten By: DANIEL KRAMER, 739699\n${shopVersionText}` }], ourSource);
        expect(second.plainSummaryExportId).toBeUndefined();
        expect(second.warnings.join("\n")).toContain(`Appraisal Dispute Report not produced: ${fileName} prints the same Workfile ID as our estimate`);
        // Another writer under our workfile on a committed print: ours, or the insurer's printed from our system.
        const other = await build([{ fileName, sourceDocumentId: "v", estimateRole: "carrier", text: `${ourHeader}\nWritten By: DANIEL KRAMER, 739699\n${carrierText}` }], ourSource);
        expect(other.plainSummaryExportId).toBeUndefined();
        expect(other.warnings.join("\n")).toContain(
          `Appraisal Dispute Report not produced: ${fileName} prints our estimate's Workfile ID but names a different writer, so nothing printed says whether it is our own estimate or the insurer's printed from our system.`
        );
      }
    }
  }, 60_000);

  // R10 #7: the selector never runs for one comparison, so the gate reads the name.
  it("a lone comparison named as another party's appraiser or an umpire's award is not the insurer's", async () => {
    for (const fileName of ["Insured's Appraiser 22279.pdf", "Independent appraiser 22279.pdf", "Owners appraiser estimate 22279.pdf", "USAA 22279 Umpire Award.pdf", "Public adjuster 22279.pdf"]) {
      const result = await build([{ fileName, sourceDocumentId: "o", estimateRole: "carrier", text: `Written By: JOHN DOE, License Number: 5\n${carrierText}` }]);
      expect(result.plainSummaryExportId).toBeUndefined();
      expect(result.warnings.join("\n")).toContain(
        `Appraisal Dispute Report not produced: ${fileName} is named as an independent or another party's appraiser, an umpire, an appraisal award or a public adjuster, so nothing shows it is the insurer's estimate.`
      );
    }
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
      (d: Delta) => (d.lower = d.lower.filter((r: EstimateDeltaRow) => r.lineNumber !== 134)),
      // Their oil pump's price unread: "they pay the part" is not shown.
      (d: Delta) => (lowerRow(d, 61).price = null),
    ]) {
      const { m, text } = model21995(mutate);
      expect(m.ledger.unreadCarrierLines + m.ledger.unreadCarrierHours).toBeGreaterThan(0);
      expect(m.items).toEqual([]);
      expect(text).not.toMatch(/No counterpart on their sheet|They pay the part/);
      expect(text).toMatch(/So no item is listed below/);
    }
  });

  it("a dropped carrier row that carries hours refuses the report rather than arguing around it", () => {
    for (const [line, labor] of [
      // Their L102 replaces the subframe with 5.5 hr, so "no counterpart"
      // for our crossmember R&I would be false.
      [102, "57.7"],
      // A labor-only row: their L2 R&I bumper (1.6 hr) is the counterpart of our O/H.
      [2, "61.6"],
    ] as const) {
      expect(() => model21995((d) => (d.lower = d.lower.filter((r: EstimateDeltaRow) => r.lineNumber !== line)))).toThrow(
        new RegExp(`^their estimate's lines carry ${labor.replace(".", "\\.")} labor and 8\\.4 paint hours as read, but it prints 63\\.2 and 8\\.4`)
      );
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
    // Dropping our L135 leaves our read short of its printed total, so the
    // line is raised as not found among the lines read, never "not on our sheet".
    const { m } = model21995((d) => (d.higher = d.higher.filter((r: EstimateDeltaRow) => r.lineNumber !== 135)));
    expect(m.flags.find((f) => f.kind === "shopLinesUnreconciled" && f.lines.carrier?.includes(102))).toBeDefined();
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
