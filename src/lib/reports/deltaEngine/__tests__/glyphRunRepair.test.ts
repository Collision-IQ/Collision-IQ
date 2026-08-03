/**
 * Glyph-run repair — the second half of M-1.
 *
 * The R5 work order's ruling on the RO 22182 GEICO Estimate of Record was that
 * "missing ToUnicode with embedded fonts is a glyph-mapping condition — repair
 * the spacing, do not hedge the finding". The hedge is gone. This covers the
 * repair.
 *
 * In its raw state that document parses to ZERO rows: its column header reads
 * "Q t y" / "L a b o r" / "P a i n t", so no column can be measured, and its
 * values arrive as "951"+"."+"88". Every finding on the pair therefore comes
 * from the text lane, and the typed engine — the thing that keeps mistyped
 * cells out of the report — never runs on it at all.
 *
 * NOTE: this capability is deliberately NOT yet wired into parseEstimateRows.
 * Enabling it switches the 22182 pair from the text lane to the typed engine,
 * which changes every finding in that pack; that is a decision to take with
 * the graded artifact in hand, not a silent one.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { parseEstimateRows, repairShatteredGlyphRuns, type Word } from "../rowCluster";

const FIXTURE_DIR = path.join(__dirname, "../../../../../tests/fixtures/22182");

function loadWords(name: string): Map<number, Word[]> {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8")) as Record<string, Word[]>;
  return new Map(Object.entries(raw).map(([page, words]) => [Number(page), words]));
}

function repaired(name: string): Map<number, Word[]> {
  return new Map([...loadWords(name).entries()].map(([page, words]) => [page, repairShatteredGlyphRuns(words)]));
}

describe("the repair rebuilds words and value cells from shattered runs", () => {
  it("merges glyph runs that sit inside one word", () => {
    const out = repairShatteredGlyphRuns([
      { text: "Co", x0: 98.96, x1: 107.75, top: 216.69, bottom: 225 },
      { text: "lli", x0: 108.06, x1: 120.06, top: 216.69, bottom: 225 },
      { text: "s", x0: 113.4, x1: 117.4, top: 216.69, bottom: 225 },
      { text: "i", x0: 117.1, x1: 121.1, top: 216.69, bottom: 225 },
      { text: "on", x0: 118.95, x1: 127.35, top: 216.69, bottom: 225 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("Collision");
  });

  it("rebuilds a value cell split across runs", () => {
    const out = repairShatteredGlyphRuns([
      { text: "951", x0: 414.2, x1: 426.4, top: 244, bottom: 252 },
      { text: ".", x0: 427.4, x1: 431.4, top: 244, bottom: 252 },
      { text: "88", x0: 429.4, x1: 437.4, top: 244, bottom: 252 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("951.88");
  });

  it("keeps genuinely separate cells apart", () => {
    const out = repairShatteredGlyphRuns([
      { text: "951.88", x0: 414, x1: 437, top: 244, bottom: 252 },
      { text: "24.5", x0: 482, x1: 497, top: 244, bottom: 252 },
      { text: "4.5", x0: 546, x1: 557, top: 244, bottom: 252 },
    ]);
    expect(out.map((word) => word.text)).toEqual(["951.88", "24.5", "4.5"]);
  });

  it("closes a letter-spaced run without touching ordinary text", () => {
    const out = repairShatteredGlyphRuns([
      { text: "Q t y", x0: 364.6, x1: 384.6, top: 114.4, bottom: 122 },
      { text: "LKQ RT quarter panel", x0: 142, x1: 242, top: 244, bottom: 252 },
    ]);
    expect(out.map((word) => word.text)).toEqual(["Q t y".replace(/\s/g, ""), "LKQ RT quarter panel"]);
  });

  it("a two-group run is never treated as letter-spaced", () => {
    const out = repairShatteredGlyphRuns([
      { text: "~ 445539221", x0: 306, x1: 350, top: 244, bottom: 252 },
    ]);
    expect(out[0].text).toBe("~ 445539221");
  });
});

describe("the GEICO Estimate of Record becomes parseable (M-1)", () => {
  it("parses zero rows before the repair", () => {
    expect(parseEstimateRows(loadWords("eor_words.json"))).toHaveLength(0);
  });

  it("parses its line items after the repair", () => {
    const rows = parseEstimateRows(repaired("eor_words.json"));
    expect(rows.length).toBeGreaterThanOrEqual(25);
    const quarterPanel = rows.find((row) => row.line === 8)!;
    expect(quarterPanel.price).toBeCloseTo(951.88, 2);
    expect(quarterPanel.labor).toBeCloseTo(24.5, 2);
    expect(quarterPanel.paint).toBeCloseTo(4.5, 2);
    expect(quarterPanel.sectionLabel).toBe("QUARTERPANEL");
    expect(quarterPanel.rawDesc).toContain("LKQ");
    expect(quarterPanel.rawDesc).toContain("Sect");
  });

  it("its body labor reconciles to the penny against its own printed SUBTOTALS", () => {
    // The document prints "SUBTOTALS 1,401.88  27.6  11.7".
    const rows = parseEstimateRows(repaired("eor_words.json"));
    const laborSum = rows.reduce((total, row) => total + (row.labor ?? 0), 0);
    expect(laborSum).toBeCloseTo(27.6, 2);
  });

  it("paint reconciles once the ALTERNATE PARTS SUPPLIERS block is excluded", () => {
    // KNOWN GAP, recorded rather than hidden: the supplier block prints
    // line-numbered quote rows ("LKQ Venice #~445539221 $761.50", "Fitext Auto
    // Parts #3206028 $425.00") whose quoted dollar amount lands in the paint
    // column. They are not operations, and the row parser has no geometric
    // table-region gate of its own to exclude them. Wiring this repair into
    // the pipeline requires closing that gap first.
    const rows = parseEstimateRows(repaired("eor_words.json"));
    const supplierRows = rows.filter((row) => (row.paint ?? 0) > 5);
    expect(supplierRows.map((row) => row.line).sort((a, b) => a - b)).toEqual([8, 20]);
    const paintSum = rows
      .filter((row) => !supplierRows.includes(row))
      .reduce((total, row) => total + (row.paint ?? 0), 0);
    expect(paintSum).toBeCloseTo(11.7, 2);
  });
});

describe("the repair never touches a document that already parses", () => {
  it("the shop estimate is unchanged by it", () => {
    const before = parseEstimateRows(loadWords("shop_words.json"));
    const after = parseEstimateRows(repaired("shop_words.json"));
    expect(after.length).toBe(before.length);
    const laborBefore = before.reduce((total, row) => total + (row.labor ?? 0), 0);
    const laborAfter = after.reduce((total, row) => total + (row.labor ?? 0), 0);
    expect(laborAfter).toBeCloseTo(laborBefore, 2);
    expect(laborAfter).toBeCloseTo(85.6, 2);
  });
});
