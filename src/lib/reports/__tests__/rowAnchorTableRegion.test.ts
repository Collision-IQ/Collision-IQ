/**
 * U-5 table region on CCC ONE prints that print the column header ONCE.
 *
 * Every page repeats the page header (title, RO line, vehicle line) and the
 * footer; only the first line-item page prints "Line Oper Description …".
 * The header page's region top (the bottom of the column header) carried to
 * the continuation pages, where rows start right under the shorter page
 * header, so the first one or two rows of every continuation page sat above
 * the carried top and were downgraded to guide_row. RO 22279's shop estimate
 * lost lines 34 and 35 this way ($504.49 + $502.50 = the $1,006.99 parts
 * residual), and the Appraisal Dispute Report then said the carrier's
 * reinforcement was "not on our sheet".
 *
 * The footer test failed the other way: it read any y repeating on 3+ pages
 * in the bottom fifth as footer, and CCC rows sit on a fixed pitch, so the
 * last rows of every full page were cut as well.
 *
 * The fixture is synthetic: the row and vehicle-line text is RO 22279's own
 * page 3, the geometry is the CCC ONE print measured on the repo's word-layer
 * fixtures (page header at 27.6 / 46.6 / 61.0, column header at 91.1, 13.5pt
 * row pitch, footer at 740.7).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildEstimateRowAnchorsFromLines,
  buildPdfTextLines,
  type EstimateRowAnchor,
  type PdfTextLine,
  type PdfWord,
} from "../citationDensityRowAnchors";
import { deltaRowFromRawText } from "../estimateDeltaMatcher";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const PITCH = 13.5;

function line(pageNumber: number, y: number, text: string, height = 8): PdfTextLine {
  return {
    pageNumber,
    text,
    normalizedText: text.toLowerCase(),
    x: 29,
    y,
    width: 400,
    height,
    pageWidth: PAGE_WIDTH,
    pageHeight: PAGE_HEIGHT,
    words: [],
  };
}

const VEHICLE = "2024 HYUN Kona SE AWD 4D UTV 4-2.0L Gasoline Sequential MPI BLUE";

/** The page header CCC ONE repeats on every page after the cover. */
function pageChrome(pageNumber: number): PdfTextLine[] {
  return [
    line(pageNumber, 27.6, "Preliminary Estimate", 10),
    line(pageNumber, 46.6, "RO Number: 90001", 10),
    line(pageNumber, 61.0, VEHICLE),
    line(pageNumber, 740.7, `10/2/2026 8:27:55 AM 300060 Page ${pageNumber}`),
  ];
}

/** Rows on the fixed pitch, starting at `firstY`. */
function rows(pageNumber: number, firstY: number, texts: string[]): PdfTextLine[] {
  return texts.map((text, index) => line(pageNumber, firstY + index * PITCH, text));
}

/**
 * Numbered rows that run a page down into its bottom band (y ≥ 633.6). Each
 * description differs in its LETTERS, as real rows do: chrome is matched
 * with digits masked, so rows differing only in numbers would read as chrome.
 */
function filler(from: number, count: number): string[] {
  const tag = (n: number) => String.fromCharCode(65 + Math.floor(n / 26), 65 + (n % 26));
  return Array.from({ length: count }, (_, index) => `${from + index} R&I Bracket ${tag(from + index)} 0.2`);
}

/** Rows per full continuation page: 79.6 + 46 × 13.5 = 700.6. */
const ROWS_PER_CONTINUATION_PAGE = 47;

function buildFixture(): PdfTextLine[] {
  // Page 1: cover. Options prose that steals a line number ("4 Wheel Drive")
  // sits on a page with no column header, so it has no table region.
  const cover = [
    line(1, 27.6, "Preliminary Estimate", 10),
    line(1, 200, "Customer: REDACTED"),
    line(1, 300, "4 Wheel Drive Tilt Wheel FM Radio Skyview Roof"),
    line(1, 313.5, "OPTIONS"),
    line(1, 740.7, "10/2/2026 8:27:55 AM 300060 Page 1"),
  ];
  // Page 2: the one page that prints the column header. Rows 1..43, the last
  // at 115.2 + 42 × 13.5 = 682.2.
  const headerPage = [
    ...pageChrome(2),
    line(2, 91.1, "Line Oper Description Part Number Qty Extended Labor Paint"),
    line(2, 101.8, "Price $"),
    ...rows(2, 115.2, ["1 FRONT BUMPER", ...filler(2, 42)]),
  ];
  // Pages 3-5: no column header. Rows start right under the repeated vehicle
  // line. Page 3 opens on RO 22279's page 3: its lines 34, 35 and 36 are 44,
  // 45 and 46 here.
  const page3 = [
    ...pageChrome(3),
    ...rows(3, 79.6, [
      "44 * Repl Skid plate SE, SEL 86671BE000 1 504.49 Incl.",
      "45 * Repl Reinforcement 86631BE200 1 502.50 0.1",
      "46 Repl Prep unprimed bumper 1 0.7",
      ...filler(47, ROWS_PER_CONTINUATION_PAGE - 3),
    ]),
  ];
  const page4 = [...pageChrome(4), ...rows(4, 79.6, filler(91, ROWS_PER_CONTINUATION_PAGE))];
  const page5 = [...pageChrome(5), ...rows(5, 79.6, filler(138, ROWS_PER_CONTINUATION_PAGE))];
  // Page 6: the table closes. Below the rule, a totals block an OCR'd print
  // labels "ESTIMATETOTALS", which the totals detector does not recognise.
  const totalsPage = [
    ...pageChrome(6),
    ...rows(6, 79.6, ["185 R&I Bumper absorber 0.3", "186 # Hazardous waste removal 1 5.00 T"]),
    line(6, 106.6, "SUBTOTALS 3,254.43 33.9 10.9"),
    line(6, 140, "ESTIMATETOTALS", 10.7),
    line(6, 156, "Category Basis Rate Cost$"),
    line(6, 170, "Parts 2,977.68"),
    line(6, 184, "BodyLabor 20.0hrs @ $90.00/hr 1,800.00"),
  ];
  // Page 7: after the SUBTOTALS rule. A numbered disclaimer right under the
  // page header is not a row.
  const legal = [
    ...pageChrome(7),
    line(7, 79.6, "1 Repl parts are subject to availability at the time of repair."),
  ];
  return [...cover, ...headerPage, ...page3, ...page4, ...page5, ...totalsPage, ...legal];
}

const anchors = buildEstimateRowAnchorsFromLines(buildFixture(), {
  sourceDocumentRole: "shop",
  sourceDocumentId: "shop-region-fixture",
});

function anchorFor(lineNumber: string): EstimateRowAnchor | undefined {
  return anchors.find((anchor) => anchor.lineNumber === lineNumber);
}

describe("continuation pages that print no column header", () => {
  it("anchors the rows that follow the repeated vehicle line as estimate_line (RO 22279 lines 34-36)", () => {
    for (const lineNumber of ["44", "45", "46"]) {
      expect(anchorFor(lineNumber)?.anchorType, `line ${lineNumber}`).toBe("estimate_line");
      expect(anchorFor(lineNumber)?.pageNumber).toBe(3);
    }
  });

  it("hands both priced rows to the delta pairing with their prices", () => {
    // The same parse matchStructuredLineItemDeltas applies to every
    // estimate_line anchor on the higher side.
    const skidPlate = deltaRowFromRawText({ rawText: anchorFor("44")!.rowText });
    const reinforcement = deltaRowFromRawText({ rawText: anchorFor("45")!.rowText });
    expect(skidPlate).toMatchObject({ opCode: "Repl", price: 504.49 });
    expect(skidPlate?.description).toMatch(/^Skid plate/);
    expect(reinforcement).toMatchObject({ opCode: "Repl", price: 502.5 });
    expect(reinforcement?.description).toMatch(/^Reinforcement/);
  });

  it("anchors the first two rows of every continuation page, not only the 22279 page", () => {
    for (const lineNumber of ["91", "92", "138", "139", "185", "186"]) {
      expect(anchorFor(lineNumber)?.anchorType, `line ${lineNumber}`).toBe("estimate_line");
    }
  });

  it("keeps the repeated vehicle line itself out of the table", () => {
    // "2024 HYUN…" has line-number shape; it must never anchor as line 2024.
    const vehicle = anchors.filter((anchor) => anchor.lineNumber === "2024");
    expect(vehicle.length).toBeGreaterThan(0);
    expect(vehicle.every((anchor) => anchor.anchorType === "guide_row")).toBe(true);
  });
});

describe("the bottom of full pages", () => {
  it("anchors the last rows of every full page: a shared y is not footer chrome when the text differs", () => {
    // Pages 3-5 put rows at the same y in the bottom fifth (fixed pitch), so
    // a position-only footer test saw a repeat on 3 pages and cut them.
    const bottomRows = ["40", "41", "42", "43", "86", "87", "88", "89", "90", "133", "137", "180", "184"];
    for (const lineNumber of bottomRows) {
      const anchor = anchorFor(lineNumber);
      expect(anchor?.anchorType, `line ${lineNumber}`).toBe("estimate_line");
    }
    expect(anchorFor("184")!.y).toBeGreaterThan(PAGE_HEIGHT * 0.8);
  });

  it("keeps the footer non-anchorable on every page", () => {
    const footers = anchors.filter((anchor) => /Page \d+$/.test(anchor.rowText));
    expect(footers.length).toBeGreaterThan(0);
    expect(footers.every((anchor) => anchor.anchorType === "guide_row")).toBe(true);
    // Footer text never bleeds into the last row above it either.
    expect(anchors.some((anchor) => anchor.anchorType === "estimate_line" && /Page \d/.test(anchor.rowText))).toBe(false);
  });
});

describe("what stays outside the table region (U-5)", () => {
  it("cover-page options prose stays non-anchorable", () => {
    const cover = anchors.filter((anchor) => anchor.pageNumber === 1);
    expect(cover.some((anchor) => anchor.anchorType === "estimate_line")).toBe(false);
    expect(anchors.find((anchor) => /4 Wheel Drive/.test(anchor.rowText))?.anchorType ?? "guide_row").toBe("guide_row");
  });

  it("a page after the SUBTOTALS rule gets no region, even directly under the page header", () => {
    const legal = anchors.filter((anchor) => anchor.pageNumber === 7);
    expect(legal.length).toBeGreaterThan(0);
    expect(legal.some((anchor) => anchor.anchorType === "estimate_line")).toBe(false);
  });

  it("text below the SUBTOTALS rule never continues the last row above it", () => {
    const last = anchorFor("186");
    expect(last?.anchorType).toBe("estimate_line");
    expect(last?.rowText).toBe("186 # Hazardous waste removal 1 5.00 T");
    expect(last?.noteText ?? "").not.toMatch(/Parts|BodyLabor|Category/);
  });
});

// ---------------------------------------------------------------------------
// The ESTIMATE TOTALS block. A category row with no totals word of its own
// ("Parts 3,180.20", "Mechanical Labor 7.7 hrs @ $ 175.00 /hr 1,347.50",
// "Deductible 500.00") read as a totals row only under the running section
// "estimate totals", and the section never reaches a block printed on the page
// after the SUBTOTALS rule: that page has no table region. The block is
// measured from its own header instead. Geometry is the RO 22084 shop print
// (title at 80.7, column header at 95.8, rows on a 13.5pt pitch from 109.3 in
// the Category column at x 143, disclaimer at the x 23 margin).
// ---------------------------------------------------------------------------

describe("an ESTIMATE TOTALS block printed on the page after the SUBTOTALS rule", () => {
  /** A measured line: one word carrying the line's text at x. */
  function at(pageNumber: number, x: number, y: number, text: string, height = 8): PdfTextLine {
    const word: PdfWord = {
      pageNumber,
      text,
      normalizedText: text.toLowerCase(),
      x,
      y,
      width: text.length * 4.4,
      height,
      pageWidth: PAGE_WIDTH,
      pageHeight: PAGE_HEIGHT,
    };
    return { ...line(pageNumber, y, text, height), x, width: word.width, words: [word] };
  }

  const CATEGORY_ROWS = [
    "Parts 3,180.20",
    "Body Labor 35.7 hrs @ $ 90.00 /hr 3,213.00",
    "Paint Labor 19.2 hrs @ $ 90.00 /hr 1,728.00",
    "Mechanical Labor 7.7 hrs @ $ 175.00 /hr 1,347.50",
    "Aluminum Or Steel Repair 5.0 hrs @ $ 135.00 /hr 675.00",
    "Bonded Or Welded Panel Replace 8.5 hrs @ $ 135.00 /hr 1,147.50",
    "Paint Supplies 19.2 hrs @ $ 60.00 /hr 1,152.00",
    "Miscellaneous 617.94",
    "Subtotal 13,061.14",
    "Sales Tax $ 13,061.14 @ 6.0000 % 783.67",
    "Grand Total 13,844.81",
  ];

  /** The block from its title down, starting at `top`. */
  function totalsBlock(
    pageNumber: number,
    top: number,
    { title = "ESTIMATE TOTALS", header = "Category Basis Rate Cost $", categories = CATEGORY_ROWS } = {}
  ): PdfTextLine[] {
    return [
      at(pageNumber, 144, top, title, 9.9),
      at(pageNumber, 143, top + 15.1, header),
      ...categories.map((text, index) => at(pageNumber, 143, top + 28.6 + index * PITCH, text)),
    ];
  }

  const DISCLAIMER = "This estimate is based on our initial visual inspection. Ocassionally, addtional worn and/or damaged";

  /** Pages 1-2: the column header prints once, on page 1; page 2 continues
   * the table and closes it with the SUBTOTALS rule. */
  function lineItemPages(): PdfTextLine[] {
    return [
      ...pageChrome(1),
      line(1, 91.1, "Line Oper Description Part Number Qty Extended Labor Paint"),
      line(1, 115.2, "1 FRONT BUMPER"),
      line(1, 128.7, "2 Repl Bumper cover 1 475.00 2.0 3.0"),
      ...pageChrome(2),
      line(2, 79.6, "MISCELLANEOUS OPERATIONS"),
      line(2, 93.1, "3 # Hazardous waste removal 1 5.00 T"),
      line(2, 106.6, "SUBTOTALS 3,180.20 35.7 19.2"),
    ];
  }

  /** The block under the repeated page header of page 3, then `rest`. */
  function blockOnPage3(blockLines: PdfTextLine[], rest: PdfTextLine[] = []): PdfTextLine[] {
    return [...lineItemPages(), ...pageChrome(3), ...blockLines, ...rest];
  }

  const anchorsOf = (lines: PdfTextLine[]) =>
    buildEstimateRowAnchorsFromLines(lines, { sourceDocumentRole: "shop", sourceDocumentId: "totals-fixture" });
  const typeOf = (found: EstimateRowAnchor[], text: string) => found.find((anchor) => anchor.rowText === text)?.anchorType;

  it("anchors every category row as totals_row, including those with no totals word (RO 22084 shop page 7)", () => {
    const found = anchorsOf(blockOnPage3(totalsBlock(3, 80.7), [at(3, 23, 292.4, DISCLAIMER, 9.9)]));
    for (const text of CATEGORY_ROWS) expect(typeOf(found, text), text).toBe("totals_row");
    // The title is a totals row by its own words; the disclaimer is not one.
    expect(found.filter((anchor) => anchor.pageNumber === 3 && anchor.anchorType === "totals_row")).toHaveLength(
      CATEGORY_ROWS.length + 1
    );
  });

  it("reads the block the same whether or not it shares the SUBTOTALS page", () => {
    const own = anchorsOf(blockOnPage3(totalsBlock(3, 80.7)));
    const shared = anchorsOf([...lineItemPages(), ...totalsBlock(2, 132.7)]);
    expect(CATEGORY_ROWS.map((text) => typeOf(shared, text))).toEqual(CATEGORY_ROWS.map(() => "totals_row"));
    expect(CATEGORY_ROWS.map((text) => typeOf(own, text))).toEqual(CATEGORY_ROWS.map((text) => typeOf(shared, text)));
  });

  it("reads an OCR'd block whose title and rows lost their spaces (RO 22047 USAA page 6)", () => {
    const ocr = [
      "Parts 3,123.43",
      "BodyLabor 20.0hrs @ $90.00/hr 1,800.00",
      "MechanicalLabor 7.9hrs @ $175.00/hr 1,382.50",
      "SalesTax $8,696.63 @ 6.0000% 521.80",
      "Deductible 1,000.00",
      "NetCostofRepairs 8,218.43",
    ];
    const found = anchorsOf(
      blockOnPage3(totalsBlock(3, 80.7, { title: "ESTIMATETOTALS", header: "Category Basis Rate Cost$", categories: ocr }))
    );
    for (const text of ocr) expect(typeOf(found, text), text).toBe("totals_row");
  });

  it("leaves the running section alone: the next page's ALTERNATE PARTS USAGE lines do not inherit it", () => {
    const usage = [
      ...pageChrome(4),
      at(4, 23, 80.7, "ALTERNATE PARTS USAGE", 9.9),
      at(4, 23, 95.8, "VIN: 5YJ3E1EB6XXXXXXXX Production Date: 05/2018 Interior Color:"),
      at(4, 23, 109.3, "Alternate Part Type # Of Available Parts # Of Parts Selected"),
      at(4, 23, 122.8, "Aftermarket 1 1"),
      at(4, 23, 136.3, "Optional OEM 0 0"),
    ];
    const found = anchorsOf(blockOnPage3(totalsBlock(3, 80.7), usage));
    const block = found.filter((anchor) => CATEGORY_ROWS.includes(anchor.rowText));
    expect(new Set(block.map((anchor) => anchor.section))).toEqual(new Set(["miscellaneous operations"]));
    // "ALTERNATE PARTS USAGE" is a supplier row by its own words. A section
    // that advanced to it would make every line under it one too.
    for (const text of ["VIN: 5YJ3E1EB6XXXXXXXX Production Date: 05/2018 Interior Color:", "Optional OEM 0 0"]) {
      expect(typeOf(found, text), text).not.toBe("supplier_row");
    }
    expect(found.filter((anchor) => anchor.pageNumber === 4 && anchor.anchorType === "totals_row")).toEqual([]);
  });

  it("ends the block at the first line outside the Category column, even on the block's pitch", () => {
    const found = anchorsOf(
      blockOnPage3(totalsBlock(3, 80.7, { categories: ["Parts 3,180.20"] }), [
        at(3, 23, 122.8, "Estimate prepared by APPRAISER, License #271128."),
        at(3, 143, 136.3, "Workfile ID 00000000"),
      ])
    );
    expect(typeOf(found, "Parts 3,180.20")).toBe("totals_row");
    expect(typeOf(found, "Estimate prepared by APPRAISER, License #271128.")).not.toBe("totals_row");
    expect(typeOf(found, "Workfile ID 00000000")).not.toBe("totals_row");
  });

  it("ends the block at a gap wider than its pitch, even in the Category column", () => {
    // RO 20766 SOR-3 prints its cumulative-effects table in that column
    // further down a totals page.
    const below = 80.7 + 28.6 + CATEGORY_ROWS.length * PITCH + 50;
    const found = anchorsOf(blockOnPage3(totalsBlock(3, 80.7), [at(3, 147, below, "Estimate 2,573.20 APPRAISER, REDACTED")]));
    expect(typeOf(found, "Grand Total 13,844.81")).toBe("totals_row");
    expect(typeOf(found, "Estimate 2,573.20 APPRAISER, REDACTED")).not.toBe("totals_row");
  });

  it("needs the column header: a lone ESTIMATE TOTALS title claims no rows", () => {
    const found = anchorsOf(
      blockOnPage3([
        at(3, 144, 80.7, "ESTIMATE TOTALS", 9.9),
        at(3, 143, 95.8, "Parts 3,180.20"),
        at(3, 143, 109.3, "Mechanical Labor 7.7 hrs @ $ 175.00 /hr 1,347.50"),
      ])
    );
    expect(typeOf(found, "Parts 3,180.20")).toBeUndefined();
    expect(typeOf(found, "Mechanical Labor 7.7 hrs @ $ 175.00 /hr 1,347.50")).toBeUndefined();
  });
});

describe("measured on the repo's ESTIMATE TOTALS blocks", () => {
  const FIXTURE_DIR = path.join(__dirname, "../../../../tests/fixtures");

  /** The three word-layer shapes in the repo, read into PdfWord[]. */
  function loadWords(relativePath: string): PdfWord[] {
    const raw = JSON.parse(readFileSync(path.join(FIXTURE_DIR, relativePath), "utf8")) as unknown;
    const page = { pageWidth: PAGE_WIDTH, pageHeight: PAGE_HEIGHT };
    if (Array.isArray(raw)) {
      return raw.map((item) =>
        "p" in item
          ? { ...page, pageNumber: item.p, text: item.t, normalizedText: item.t.toLowerCase(), x: item.x, y: item.y, width: item.w, height: 9 }
          : { ...item, normalizedText: item.text.toLowerCase() }
      );
    }
    return Object.entries(raw as Record<string, Array<{ text: string; x0: number; x1: number; top: number; bottom: number }>>).flatMap(
      ([pageNumber, list]) =>
        list.map((item) => ({
          ...page,
          pageNumber: Number(pageNumber),
          text: item.text,
          normalizedText: item.text.toLowerCase(),
          x: item.x0,
          y: item.top,
          width: item.x1 - item.x0,
          height: item.bottom - item.top,
        }))
    );
  }

  // [fixture, page, the block's rows by category label]. The first four print
  // the block on the page after the SUBTOTALS rule, the next four on the
  // SUBTOTALS page, and the USAA print is OCR'd.
  const BLOCKS: Array<[string, number, string[]]> = [
    ["22084/shop_words.json", 7, ["Parts", "Body Labor", "Paint Labor", "Mechanical Labor", "Aluminum Or Steel Repair", "Bonded Or Welded Panel Replace", "Paint Supplies", "Miscellaneous", "Subtotal", "Sales Tax", "Grand Total"]],
    ["22182/shop_words.json", 8, ["Parts", "Body Labor", "Paint Labor", "Mechanical Labor", "Aluminum Or Steel Repair", "Bonded Or Welded Panel Replace", "Paint Supplies", "Miscellaneous", "Subtotal", "Sales Tax", "Grand Total"]],
    ["21995/sor3_words.json", 8, ["Parts", "Body Labor", "Paint Labor", "Mechanical Labor", "Frame Labor", "Paint Supplies", "Subtotal", "Sales Tax", "Total Cost of Repairs", "Deductible", "Total Adjustments", "Net Cost of Repairs"]],
    ["20766/sor3_words.json", 4, ["Parts", "Body Labor", "Paint Labor", "Mechanical Labor", "Paint Supplies", "Miscellaneous", "Other Charges", "Subtotal", "Sales Tax", "Total Cost of Repairs", "Deductible", "Total Adjustments", "Net Cost of Repairs"]],
    ["20766/shop_words.json", 5, ["Parts", "Body Labor", "Paint Labor", "Mechanical Labor", "Electrical Labor", "Aluminum Or Steel Repair", "Calibration/Reset", "Paint Supplies", "Miscellaneous", "Subtotal", "Sales Tax", "Grand Total"]],
    ["22047/shop_words.json", 5, ["Parts", "Body Labor", "Paint Labor", "Mechanical Labor", "Aluminum Or Steel Repair", "Paint Supplies", "Miscellaneous", "Subtotal", "Sales Tax", "Grand Total"]],
    ["22084/sor5_words.json", 6, ["Parts", "Body Labor", "Paint Labor", "Mechanical Labor", "Structural Labor", "Paint Supplies", "Other Charges", "Subtotal", "Sales Tax", "Total Cost of Repairs", "Total Adjustments", "Net Cost of Repairs"]],
    ["ccc-1259209948-words.json", 5, ["Parts", "Body Labor", "Paint Labor", "Paint Supplies", "Miscellaneous", "Subtotal", "Sales Tax", "Grand Total"]],
    ["22047/usaa_words.json", 6, ["Parts", "BodyLabor", "PaintLabor", "MechanicalLabor", "Aluminum", "PaintSupplies", "Miscellaneous", "Subtotal", "SalesTax", "TotalCostofRepairs", "Deductible", "TotalAdjustments", "NetCostofRepairs"]],
  ];

  for (const [relativePath, pageNumber, labels] of BLOCKS) {
    it(`${relativePath} page ${pageNumber}: every category row anchors as totals_row`, () => {
      const found = buildEstimateRowAnchorsFromLines(buildPdfTextLines(loadWords(relativePath)), {
        sourceDocumentRole: "shop",
        sourceDocumentId: relativePath,
      });
      const onPage = found.filter((anchor) => anchor.pageNumber === pageNumber);
      for (const label of labels) {
        const rows = onPage.filter((anchor) => anchor.rowText.startsWith(`${label} `));
        expect(rows.map((anchor) => anchor.anchorType), label).toEqual(["totals_row"]);
      }
    });
  }
});
