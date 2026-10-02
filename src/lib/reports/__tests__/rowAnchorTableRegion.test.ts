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
import { describe, expect, it } from "vitest";
import {
  buildEstimateRowAnchorsFromLines,
  type EstimateRowAnchor,
  type PdfTextLine,
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
