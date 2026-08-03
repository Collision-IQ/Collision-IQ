/**
 * tests/fixtures/22182 — the R4 HOLDOUT pair, now permanent corpus: a
 * different carrier, make, impact zone, and producer layout (column header
 * printed once, County Tax lane, user-defined labor-class digits) than the
 * 22047 tuning fixture. Guards the defects the holdout run surfaced.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import {
  parseEstimateRows,
  parseSubtotalsFromWords,
  parseTotalsFromWords,
  type EstimateRow,
  type Word,
} from "../rowCluster";
import { canonTotalsCategoryDetailed } from "../estimateNormalize";

const FIXTURE_DIR = path.join(__dirname, "../../../../../tests/fixtures/22182");

function loadWords(name: string): Map<number, Word[]> {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8")) as Record<string, Word[]>;
  return new Map(Object.entries(raw).map(([page, words]) => [Number(page), words]));
}

let shop: EstimateRow[];

beforeAll(() => {
  shop = parseEstimateRows(loadWords("shop_words.json"));
});

describe("labor-class digit is the CLASS, never the paint column (C-4)", () => {
  it("L99 Front pillar: labor 3.6, class '2', paint 0.7", () => {
    const row = shop.find((candidate) => candidate.line === 99)!;
    expect(row.labor).toBe(3.6);
    expect(row.laborClass).toBe("2");
    expect(row.paint).toBe(0.7);
  });
  it("L107 Outer wheelhouse: paint 0.7, never the class digit", () => {
    const row = shop.find((candidate) => candidate.line === 107)!;
    expect(row.paint).toBe(0.7);
  });
  it("no row's paint cell carries a bare class-digit value from the class position", () => {
    for (const row of shop) {
      if (row.laborClass && /^[1-4]$/.test(row.laborClass)) {
        expect(row.paint === null || row.paint !== Number(row.laborClass) || String(row.paint).includes(".")).toBeTruthy();
      }
    }
  });
});

describe("totals vocabulary resolves on the holdout producer (C-1)", () => {
  it("every shop totals category maps to a concept — including the largest", () => {
    const totals = parseTotalsFromWords(loadWords("shop_words.json")).filter((row) => row.amount > 0);
    expect(totals.length).toBeGreaterThanOrEqual(8);
    const unmapped = totals.filter((row) => !canonTotalsCategoryDetailed(row.category).concept);
    expect(unmapped.map((row) => row.category)).toEqual([]);
    const bonded = totals.find((row) => /bonded/i.test(row.category));
    expect(bonded?.amount).toBeCloseTo(4063.5, 2);
  });
});

describe("per-row values are bounded by the document's own SUBTOTALS (S-1)", () => {
  it("Σ per-row labor and paint equals the printed SUBTOTALS rule", () => {
    const printed = parseSubtotalsFromWords(loadWords("shop_words.json"));
    expect(printed).not.toBeNull();
    expect(printed!.labor).toBeCloseTo(85.6, 2);
    expect(printed!.paint).toBeCloseTo(31.2, 2);
    const laborSum = shop.reduce((total, row) => total + (row.labor ?? 0), 0);
    const paintSum = shop.reduce((total, row) => total + (row.paint ?? 0), 0);
    expect(laborSum).toBeCloseTo(printed!.labor!, 2);
    expect(paintSum).toBeCloseTo(printed!.paint!, 2);
  });

  it("no single row exceeds the whole document's declared hours", () => {
    const printed = parseSubtotalsFromWords(loadWords("shop_words.json"))!;
    for (const row of shop) {
      expect(row.labor ?? 0).toBeLessThanOrEqual(printed.labor!);
      expect(row.paint ?? 0).toBeLessThanOrEqual(printed.paint!);
    }
  });

  it("L118 keeps the 3M product number in its description, not in a value cell", () => {
    const row = shop.find((candidate) => candidate.line === 118)!;
    expect(row.rawDesc).toContain("07333");
    expect(row.labor).toBeNull();
    expect(row.paint).toBeNull();
    expect(row.price).toBeCloseTo(156.63, 2);
  });
});

describe("extraction completeness on the holdout pair (C-10 inputs)", () => {
  it("shop parses substantially complete (coverage above the intake gate)", () => {
    const lines = shop.map((row) => row.line);
    const coverage = lines.length / (Math.max(...lines) - Math.min(...lines) + 1);
    expect(coverage).toBeGreaterThan(0.5);
  });
});
