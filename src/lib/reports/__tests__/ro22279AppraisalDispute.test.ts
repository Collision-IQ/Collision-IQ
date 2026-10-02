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
 *      calibration (their road test left out), an O/0 part-number "variant",
 *      and "Skid plate [REDACTED_PLATE], SEL".
 * D8 — the class: any carrier line-read SHORTFALL refused the whole report.
 *      It is now stated, bounded and disclosed; an over-read still refuses.
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
import { buildEstimateRowAnchorsFromLines, type PdfTextLine } from "../citationDensityRowAnchors";
import {
  describeExcludedComparisons,
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
        /^Compared against SOR-1_22279\.pdf only\. Not compared: Shop_final_22279\.pdf \(it was not read as carrier-authored\)/
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
  it("adopts the later labeled VIN only where the fold guessed", () => {
    expect(isValidVin(VIN)).toBe(true);
    const filler = "Line items and page furniture. ".repeat(4);
    expect(findVin(`VIN: 5YJSA1E65NFO88007 Production Date\n${filler}\nVIN: ${VIN} Production Date`)).toBe(VIN);
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

  it("keeps a trim code and a part word after 'plate'", () => {
    expect(text).not.toMatch(/REDACTED_PLATE/);
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
    expect(text).toMatch(/No counterpart read on their sheet/);
    expect((await renderPlainSummaryPdf(model)).pageCount).toBeGreaterThan(0);
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

  it("says why a shop-vs-shop run has no dispute report", async () => {
    const result = await build([{ fileName: "Shop prelim.pdf", sourceDocumentId: "prelim", estimateRole: "shop", text: shopVersionText }]);
    expect(result.plainSummaryExportId).toBeUndefined();
    expect(result.warnings.join("\n")).toMatch(/Appraisal Dispute Report not produced: .*Shop prelim\.pdf was read as a shop estimate/);
  });
});
