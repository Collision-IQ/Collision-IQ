/**
 * Digit-led description wraps are continuation text, never line numbers.
 *
 * A CCC description that wraps can start its second printed line with a
 * digit: "3 Ft" under "Trim Masking Tape-3M 06347-Per", "6.5mm" under "Rear
 * body structural bulb rivet", "8.0x5-0.9" under "RT Tail lamp assy
 * grommet". Read as text alone, that digit is a line number, so each wrap
 * became its own estimate_line anchor claiming line 3, 6 or 8 (four anchors
 * all named p4:8 on RO 22084's SOR 5). The geometry says otherwise: printed
 * line numbers sit in the line-number column at the left margin, and the wrap
 * starts in the description column.
 *
 * The column is measured per document from the print's own words, never a
 * hardcoded x. A wrap that starts past it continues the row above, and its
 * text joins the end of that row's description cell, ahead of the value
 * columns, because the text lane reads digits after the columns as columns
 * ("…06347-Per 1 7.04 T 3 Ft" would parse 3.0 labor hours).
 *
 * The synthetic fixture uses the CCC ONE geometry measured on the repo's word
 * fixtures: right-aligned line numbers ending near x 42, "#" at 56.8, the
 * operation at 117.1, the description at 143.2, part number 306.4, qty 381.5,
 * price 418-440, labor 486, paint 546, a 10.7pt wrap pitch. Row texts are
 * RO 22084 / RO 20766 / RO 22182 rows as printed.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildEstimateRowAnchorsFromLines,
  buildPdfTextLines,
  type EstimateRowAnchor,
  type PdfWord,
} from "../citationDensityRowAnchors";
import { deltaRowFromRawText } from "../estimateDeltaMatcher";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const PITCH = 13.5;
const WRAP_DROP = 10.7;
const HEIGHT = 8;

function word(pageNumber: number, x: number, y: number, text: string, width = text.length * 4.4): PdfWord {
  return {
    pageNumber,
    text,
    normalizedText: text.toLowerCase(),
    x,
    y,
    width,
    height: HEIGHT,
    pageWidth: PAGE_WIDTH,
    pageHeight: PAGE_HEIGHT,
  };
}

/** A right-aligned line number whose right edge sits at x 42.1. */
function lineNumber(pageNumber: number, y: number, n: number): PdfWord {
  const width = String(n).length * 4.35;
  return word(pageNumber, 42.1 - width, y, String(n), width);
}

type Cell = [x: number, text: string];

function row(pageNumber: number, y: number, n: number, cells: Cell[]): PdfWord[] {
  return [lineNumber(pageNumber, y, n), ...cells.map(([x, text]) => word(pageNumber, x, y, text))];
}

const DESCRIPTION_X = 143.2;

/** Rows 1..8 are ordinary one-line rows, so lines 3, 6 and 8 really exist and
 * a wrap that steals one of those numbers collides with a real row. */
function buildWords(): PdfWord[] {
  const words: PdfWord[] = [
    word(2, 27.6, 91.1, "Line"),
    word(2, 117.1, 91.1, "Oper"),
    word(2, DESCRIPTION_X, 91.1, "Description"),
    word(2, 306.4, 91.1, "Part Number"),
    word(2, 381.5, 91.1, "Qty"),
    word(2, 418, 91.1, "Extended"),
    word(2, 486, 91.1, "Labor"),
    word(2, 546, 91.1, "Paint"),
  ];
  let y = 115.2;
  for (let n = 1; n <= 8; n += 1) {
    words.push(...row(2, y, n, [[120, "R&I"], [DESCRIPTION_X, `Bracket ${String.fromCharCode(64 + n)}`], [486.4, "0.2"]]));
    y += PITCH;
  }
  // RO 22182 line 53: a date-led wrap, on a row whose only value is labor.
  words.push(...row(2, y, 9, [[120, "R&I"], [DESCRIPTION_X, "RT Upr ctr plr trim from"], [487.9, "0.4"]]));
  words.push(word(2, DESCRIPTION_X, y + WRAP_DROP, "12/28/2017 w/o ultra suede"));
  y += PITCH + WRAP_DROP;
  // RO 22084 line 47: a measurement wrap under a row with a part number.
  words.push(
    ...row(2, y, 10, [
      [56.8, "#"],
      [117.1, "Repl"],
      [DESCRIPTION_X, "Rear body structural bulb rivet"],
      [306.4, "1063943-00-A"],
      [379.6, "23"],
      [424.1, "8.05"],
    ])
  );
  words.push(word(2, DESCRIPTION_X, y + WRAP_DROP, "6.5mm"));
  y += PITCH + WRAP_DROP;
  // RO 22084 line 110.
  words.push(
    ...row(2, y, 11, [
      [117.1, "Repl"],
      [DESCRIPTION_X, "RT Tail lamp assy grommet"],
      [306.4, "110433500B"],
      [379.6, "2"],
      [417.6, "10.00"],
      [481.7, "Incl."],
    ])
  );
  words.push(word(2, DESCRIPTION_X, y + WRAP_DROP, "8.0x5-0.9"));
  y += PITCH + WRAP_DROP;
  // RO 20766 line 48: the measurement unit wraps, values print on line one.
  words.push(
    ...row(2, y, 12, [
      [56.8, "#"],
      [DESCRIPTION_X, "Trim Masking Tape-3M 06347-Per"],
      [381.5, "1"],
      [424.1, "7.04"],
      [445.6, "T"],
    ])
  );
  words.push(word(2, DESCRIPTION_X, y + WRAP_DROP, "3 Ft"));
  y += PITCH + WRAP_DROP;
  words.push(...row(2, y, 13, [[120, "R&I"], [DESCRIPTION_X, "Bumper absorber"], [486.4, "0.3"]]));
  y += PITCH;
  words.push(word(2, 27.6, y + 4, "SUBTOTALS"), word(2, 418, y + 4, "1,240.16"));
  return words;
}

function anchorsOf(words: PdfWord[], options?: { dropWords?: boolean }) {
  const lines = buildPdfTextLines(words).map((line) => (options?.dropWords ? { ...line, words: [] } : line));
  return buildEstimateRowAnchorsFromLines(lines, { sourceDocumentRole: "shop", sourceDocumentId: "wrap-fixture" });
}

const anchors = anchorsOf(buildWords());
const numbered = (list: EstimateRowAnchor[], n: string) => list.filter((anchor) => anchor.lineNumber === n);
const anchorFor = (n: string) => {
  const found = numbered(anchors, n);
  expect(found, `anchors numbered ${n}`).toHaveLength(1);
  return found[0];
};

describe("a wrap that starts in the description column carries no line number", () => {
  it("leaves exactly one anchor on each real line the wraps' digits would have stolen", () => {
    for (const n of ["3", "6", "8", "12"]) {
      expect(anchorFor(n).rowText, `line ${n}`).toMatch(new RegExp(`^${n} `));
    }
  });

  it("never anchors wrap text as an operation row of its own", () => {
    const wrapStarts = /^(?:3 Ft|6\.5mm|8\.0x5-0\.9|12\/28\/2017)/;
    expect(anchors.filter((anchor) => wrapStarts.test(anchor.rowText))).toEqual([]);
  });

  it("keeps every real row numbered: right-aligned 1- and 2-digit line numbers share the measured column", () => {
    for (let n = 1; n <= 13; n += 1) {
      expect(anchorFor(String(n)).anchorType, `line ${n}`).toBe("estimate_line");
    }
  });
});

describe("the wrap continues the row above, inside its description cell", () => {
  it("joins each wrap to the end of the description, ahead of the value columns", () => {
    expect(anchorFor("9").rowText).toBe("9 R&I RT Upr ctr plr trim from 12/28/2017 w/o ultra suede 0.4");
    expect(anchorFor("10").rowText).toBe("10 # Repl Rear body structural bulb rivet 6.5mm 1063943-00-A 23 8.05");
    expect(anchorFor("11").rowText).toBe("11 Repl RT Tail lamp assy grommet 8.0x5-0.9 110433500B 2 10.00 Incl.");
    expect(anchorFor("12").rowText).toBe("12 # Trim Masking Tape-3M 06347-Per 3 Ft 1 7.04 T");
  });

  it("grows the anchor to cover the wrapped line", () => {
    const single = anchorFor("13").height;
    for (const n of ["9", "10", "11", "12"]) {
      expect(anchorFor(n).height, `line ${n}`).toBeGreaterThan(single + WRAP_DROP / 2);
    }
  });

  it("hands the delta pairing the printed description with every value cell intact", () => {
    // The same parse matchStructuredLineItemDeltas applies to each anchor.
    expect(deltaRowFromRawText({ rawText: anchorFor("9").rowText })).toMatchObject({
      opCode: "R&I",
      description: "RT Upr ctr plr trim from 12/28/2017 w/o ultra suede",
      labor: 0.4,
    });
    expect(deltaRowFromRawText({ rawText: anchorFor("10").rowText })).toMatchObject({
      description: "Rear body structural bulb rivet 6.5mm",
      partNumber: "1063943-00-A",
      qty: 23,
      price: 8.05,
    });
    expect(deltaRowFromRawText({ rawText: anchorFor("11").rowText })).toMatchObject({
      description: "RT Tail lamp assy grommet 8.0x5-0.9",
      partNumber: "110433500B",
      qty: 2,
      price: 10,
      laborIncluded: true,
    });
    // Appended after the columns instead, "3" read as 3.0 labor hours.
    expect(deltaRowFromRawText({ rawText: anchorFor("12").rowText })).toMatchObject({
      description: "Trim Masking Tape-3M 06347-Per 3 Ft",
      qty: 1,
      price: 7.04,
      labor: null,
    });
  });
});

describe("where the column cannot be measured, the text-only reading stands", () => {
  it("stored-text lines carry no words, so a digit-led line still reads as numbered", () => {
    const stored = anchorsOf(buildWords(), { dropWords: true });
    expect(stored.some((anchor) => anchor.lineNumber === "6" && anchor.rowText === "6.5mm")).toBe(true);
  });

  it("two numbered rows are too few to measure a column", () => {
    const few = anchorsOf([
      word(2, 27.6, 91.1, "Line Oper Description Part Number Qty Extended Labor Paint"),
      ...row(2, 115.2, 1, [[120, "R&I"], [DESCRIPTION_X, "Bracket A"], [486.4, "0.2"]]),
      ...row(2, 128.7, 2, [[117.1, "Repl"], [DESCRIPTION_X, "Rear body structural bulb rivet"], [424.1, "8.05"]]),
      word(2, DESCRIPTION_X, 139.4, "6.5mm"),
    ]);
    expect(few.some((anchor) => anchor.lineNumber === "6" && anchor.rowText === "6.5mm")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The real prints the defect was found on. Three fixture shapes exist; each
// is read into PdfWord[] the way its producer emits words.
// ---------------------------------------------------------------------------

const FIXTURES = path.join(__dirname, "../../../../tests/fixtures");

function loadWords(relative: string): PdfWord[] {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, relative), "utf8")) as unknown;
  if (Array.isArray(raw)) {
    return (raw as PdfWord[]).map((item) => ({ ...item, normalizedText: item.normalizedText ?? item.text.toLowerCase() }));
  }
  const words: PdfWord[] = [];
  for (const [page, list] of Object.entries(raw as Record<string, Array<{ text: string; x0: number; x1: number; top: number; bottom: number }>>)) {
    for (const item of list) {
      words.push({
        pageNumber: Number(page),
        text: item.text,
        normalizedText: item.text.toLowerCase(),
        x: item.x0,
        y: item.top,
        width: item.x1 - item.x0,
        height: item.bottom - item.top,
        pageWidth: PAGE_WIDTH,
        pageHeight: PAGE_HEIGHT,
      });
    }
  }
  return words;
}

function fixtureAnchors(relative: string) {
  return buildEstimateRowAnchorsFromLines(buildPdfTextLines(loadWords(relative)), {
    sourceDocumentRole: "shop",
    sourceDocumentId: relative,
  });
}

describe("RO 22084 SOR 5: measurement wraps on pages 3-4", () => {
  const sor5 = fixtureAnchors("22084/sor5_words.json");
  const line = (n: string) => sor5.filter((anchor) => anchor.lineNumber === n && anchor.anchorType === "estimate_line");

  it("no wrap anchors as line 6 or line 8", () => {
    expect(sor5.filter((anchor) => /^(?:6\.5mm|8\.2x12\.2|8\.0x5-0\.9)/.test(anchor.rowText))).toEqual([]);
    // The SOR prints its real line 6 on page 3 as well (a supplement row), so
    // the "6.5mm" wrap used to share its anchor id, p3:6:estimate_line.
    expect(line("6").map((anchor) => anchor.rowText)).toEqual(["6 * S03 R&I LT/Rear R&I wheel 0 0.00 m 0.2 M 0.0"]);
    expect(line("8")).toEqual([]);
  });

  it("each wrap continues its row's description", () => {
    expect(line("40")[0]?.rowText).toMatch(/structural bulb rivet 6\.5mm 1063943-00-A 23 23\.00/);
    expect(line("75")[0]?.rowText).toMatch(/grommet 8\.2x12\.2 110492600B/);
    expect(line("77")[0]?.rowText).toMatch(/grommet 8\.0x5-0\.9 110433500B/);
    expect(line("78")[0]?.rowText).toMatch(/grommet 8\.0x5-0\.9 110433500B/);
  });
});

describe("the masking-tape wrap \"3 Ft\" on RO 20766 and RO 22047 shop prints", () => {
  // RO 20766 is a pdf.js word layer (text runs); RO 22047 is a per-word layer.
  for (const [relative, rows] of [
    ["20766/shop_words.json", ["48", "55"]],
    ["22047/shop_words.json", ["20", "24", "29"]],
  ] as const) {
    it(`${relative}: "3 Ft" joins rows ${rows.join(", ")} and is never line 3 of its page`, () => {
      const list = fixtureAnchors(relative);
      expect(list.filter((anchor) => anchor.rowText.startsWith("3 Ft"))).toEqual([]);
      for (const n of rows) {
        const anchor = list.find((item) => item.lineNumber === n && item.anchorType === "estimate_line");
        expect(anchor?.rowText, `line ${n}`).toMatch(/Trim Masking Tape-3M 06347-Per 3 Ft \d+ [\d.]+ T$/);
        expect(deltaRowFromRawText({ rawText: anchor!.rowText })?.labor ?? null, `line ${n} labor`).toBeNull();
      }
    });
  }
});

describe("the Mitchell print", () => {
  it("measures its own line-number column and stops reading the page footer \"4.0\" as line 4", () => {
    const words = (
      JSON.parse(fs.readFileSync(path.join(FIXTURES, "frk2-mitchell-words.json"), "utf8")) as Array<{ p: number; x: number; y: number; w: number; t: string }>
    ).map((item) => word(item.p, item.x, item.y, item.t, item.w));
    const list = buildEstimateRowAnchorsFromLines(buildPdfTextLines(words), { sourceDocumentRole: "shop" });
    expect(list.filter((anchor) => anchor.rowText === "4.0")).toEqual([]);
    const line4 = list.filter((anchor) => anchor.lineNumber === "4");
    expect(line4).toHaveLength(1);
    expect(line4[0].rowText).toMatch(/^4 AUTO Frt Bumper Cover/);
    // Every numbered operation row keeps its number.
    for (let n = 1; n <= 93; n += 1) {
      expect(list.some((anchor) => anchor.lineNumber === String(n)), `line ${n}`).toBe(true);
    }
  });
});
