/**
 * tests/fixtures/22047 — adjudicated regression suite for the delta engine.
 * Reference render: Shop_22047_delta_annotated_final.pdf. Do NOT edit engine
 * rules just to make a guard pass; a red guard means the implementation is
 * wrong or the adjudication needs human re-review.
 *
 * Fixture data is the raw Word[] layer of both PDFs (layout-aware extraction,
 * top-left origin) so the full extract -> cluster -> pair path stays under test.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import { pairAndCompare, compareTotals, type Finding } from "../deltaPair";
import { parseEstimateRows, parseTotalsFromWords, type EstimateRow, type Word } from "../rowCluster";
import { canonTotalsCategory } from "../estimateNormalize";

const FIXTURE_DIR = path.join(__dirname, "../../../../../tests/fixtures/22047");

function loadWords(name: string): Map<number, Word[]> {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8")) as Record<string, Word[]>;
  return new Map(Object.entries(raw).map(([page, words]) => [Number(page), words]));
}

function loadFixturePair(): { shop: EstimateRow[]; usaa: EstimateRow[] } {
  return {
    shop: parseEstimateRows(loadWords("shop_words.json")),
    usaa: parseEstimateRows(loadWords("usaa_words.json")),
  };
}

let findings: Finding[];
let competingOnly: EstimateRow[];
const at = (line: number) => findings.filter((f) => f.subject.line === line);
const delta = (line: number, field: string, a?: number, b?: number) =>
  at(line).some((f) =>
    f.deltas.some(
      (d) =>
        d.field === field &&
        (a === undefined || Math.abs((d.subject as number) - a) < 0.01) &&
        (b === undefined || Math.abs((d.competing as number) - b) < 0.01)
    )
  );

beforeAll(() => {
  const { shop, usaa } = loadFixturePair();
  ({ findings, competingOnly } = pairAndCompare(shop, usaa));
});

describe("MUST NOT flag (false positives in prior builds)", () => {
  for (const [name, line] of [
    ["RT upper panel", 47],
    ["LT upper panel", 48],
    ["RT battery", 6],
    ["LT battery", 7],
    ["pillar applique RT", 22],
    ["pillar applique LT", 23],
    ["glass applique RT", 27],
    ["glass applique LT", 28],
    ["tint", 105],
    ["tailgate clear coat", 60],
    ["LT outer bracket", 42],
    ["LT support bracket", 46],
    ["RT side trim panel", 49],
    ["LT lower molding", 44],
    ["nameplate RIVIAN", 63],
    ["flatliner", 58],
    ["buff light bar", 70],
    ["TruPoint", 88],
  ] as const)
    it(`${name} (equal on both) emits no finding`, () => expect(at(line as number)).toHaveLength(0));
  it("cavity wax price equal (labor 0.2 delta allowed)", () => expect(delta(65, "price")).toBe(false));
});

describe("MUST flag with the correct typed cell", () => {
  it("side panel blends: PAINT 2.6->1.3 both sides", () => {
    expect(delta(31, "paint", 2.6, 1.3)).toBe(true);
    expect(delta(32, "paint", 2.6, 1.3)).toBe(true);
  });
  it("roof rails: PAINT 2.0->1.0 both sides", () => {
    expect(delta(16, "paint", 2.0, 1.0)).toBe(true);
    expect(delta(17, "paint", 2.0, 1.0)).toBe(true);
  });
  it("roof moldings: LABOR 1.0->0.5 both sides", () => {
    expect(delta(18, "labor", 1.0, 0.5)).toBe(true);
    expect(delta(19, "labor", 1.0, 0.5)).toBe(true);
  });
  it("back glass LABOR 1.0->0.5", () => expect(delta(26, "labor", 1.0, 0.5)).toBe(true));
  it("pre/post scans LABOR 1.0->0.5", () => {
    expect(delta(84, "labor", 1.0, 0.5)).toBe(true);
    expect(delta(93, "labor", 1.0, 0.5)).toBe(true);
  });
  it("side brackets PRICE 99.00->96.22 both sides", () => {
    expect(delta(76, "price", 99, 96.22)).toBe(true);
    expect(delta(77, "price", 99, 96.22)).toBe(true);
  });
  it("bumper cover + tailgate mldg part# changes", () => {
    expect(delta(75, "part#")).toBe(true);
    expect(delta(61, "part#")).toBe(true);
  });
  it("mask jambs LABOR 1.5->0.3 and PRICE 15->5", () => {
    expect(delta(104, "labor", 1.5, 0.3)).toBe(true);
    expect(delta(104, "price", 15, 5)).toBe(true);
  });
  it("maintain HV PRICE 5->0", () => expect(delta(108, "price", 5, 0)).toBe(true));
  it("tape aggregated as QTY_SHORTFALL 42.48->20.00", () =>
    expect(
      findings.some(
        (f) =>
          f.kind === "QTY_SHORTFALL" &&
          f.deltas.some(
            (d) =>
              d.field === "price" &&
              Math.abs((d.subject as number) - 42.48) < 0.01 &&
              Math.abs((d.competing as number) - 20) < 0.01
          )
      )
    ).toBe(true));
});

describe("MUST be MISSED on competing", () => {
  for (const [name, line] of [
    ["procedure research", 2],
    ["torque hardware", 14],
    ["in-process scan", 85],
    ["DTC research", 97],
    ["final road test", 98],
    ["ADAS research", 99],
    ["test fit tailgate", 66],
    ["test fit bumper", 82],
    ["pre-wash", 101],
    ["mask for refinishing", 103],
    ["clean for delivery", 107],
    ["solid waste", 110],
  ] as const)
    it(String(name), () => expect(at(line as number).some((f) => f.kind === "MISSED")).toBe(true));
});

describe("reverse pass", () => {
  it("competing-only lines reported, incl. HV deactivate 2.8M and $100 alignment sublet", () => {
    expect(competingOnly.length).toBeGreaterThanOrEqual(10);
  });
});

describe("ESTIMATE TOTALS pass with measured cell boxes", () => {
  it("compares every labor category cell-by-cell and records hour-cell bboxes", () => {
    const shopTotals = parseTotalsFromWords(loadWords("shop_words.json"));
    const usaaTotals = parseTotalsFromWords(loadWords("usaa_words.json"));
    expect(shopTotals.length).toBeGreaterThanOrEqual(5);
    expect(usaaTotals.length).toBeGreaterThanOrEqual(5);
    for (const row of shopTotals) if (row.hours !== null) expect(row.hoursBox).not.toBeNull();
    const deltas = compareTotals(shopTotals, usaaTotals, canonTotalsCategory);
    const hourGap = (category: RegExp, subject: number, competing: number) =>
      deltas.some(
        (d) =>
          d.field === "hours" &&
          category.test(d.category) &&
          Math.abs(d.subject - subject) < 0.01 &&
          Math.abs(d.competing - competing) < 0.01
      );
    expect(hourGap(/Body/i, 23.8, 20.0)).toBe(true);
    expect(hourGap(/Paint Labor/i, 16.7, 10.9)).toBe(true);
    expect(hourGap(/Mechanical/i, 8.8, 7.9)).toBe(true);
    expect(hourGap(/Aluminum/i, 8.0, 6.0)).toBe(true);
    expect(
      deltas.some((d) => d.field === "rate" && /Supplies/i.test(d.category) && d.subject === 60 && d.competing === 43)
    ).toBe(true);
  });
});
