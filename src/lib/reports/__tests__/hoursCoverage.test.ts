/**
 * Extraction coverage measured in HOURS, against the document's own totals.
 *
 * The existing line-span test asks whether the numbering was read. It counts a
 * row as covered even when that row's hours were lost, so partial extraction —
 * OCR recovering 22 of 64 priced lines off a scanned estimate — clears it while
 * the 42 unread carrier lines silently become confident absence claims. Unlike
 * total extraction failure, nothing in that output looks wrong.
 *
 * TWO THINGS THIS MEASUREMENT COST, both found by running it on the corpus
 * before trusting it:
 *
 *   It works at the TOTAL level, not per category. A CCC row's labor column is
 *   hours regardless of labor TYPE — the type is a letter suffix on the row —
 *   so parsed rows cannot be split into Body / Paint / Mechanical to match the
 *   printed categories. Per-category coverage is not derivable without
 *   per-provider work, whatever the totals block appears to offer.
 *
 *   Materials billed hourly are not labor. "Paint Supplies 29.7 hrs @ $60/hr"
 *   is a consumables charge computed FROM the paint hours; counting it inflated
 *   RO 22059's 96.2 real labor hours to 125.9 and dropped a correctly-parsed
 *   document to 73% — a few points from the gate.
 *
 * Measured coverage on correctly-read corpus documents after both fixes:
 * 84, 89, 93, 93, 95, 95% (lowest 72%). The gate sits at 50%.
 */
import { describe, it, expect } from "vitest";
import { assessHoursCoverage } from "../estimateDeltaMatcher";

const TOTALS = [
  "ESTIMATE TOTALS",
  "CategoryBasisRateCost $",
  "Parts12,215.15",
  "Body Labor52.7 hrs@$ 90.00 /hr4,743.00",
  "Paint Labor29.7 hrs@$ 90.00 /hr2,673.00",
  "Mechanical Labor9.3 hrs@$ 175.00 /hr1,627.50",
  "Aluminum Or Steel Repair4.5 hrs@$ 135.00 /hr607.50",
  "Paint Supplies29.7 hrs@$ 60.00 /hr1,782.00",
].join("\n");

/** RO 22059's printed labor: 52.7 + 29.7 + 9.3 + 4.5 = 96.2 — supplies excluded. */
const PRINTED_LABOR_HOURS = 96.2;

const rowsTotalling = (hours: number) => [{ labor: hours, paint: 0 }];

describe("materials billed hourly are not labor performed", () => {
  it("excludes Paint Supplies from the printed denominator", () => {
    const result = assessHoursCoverage(rowsTotalling(PRINTED_LABOR_HOURS), TOTALS);
    expect(result.printedHours).toBeCloseTo(PRINTED_LABOR_HOURS, 1);
    // Counting supplies would make this 125.9 and the coverage 76%.
    expect(result.printedHours).not.toBeCloseTo(125.9, 1);
    expect(result.coverage).toBeCloseTo(1, 2);
    expect(result.gate).toBe(false);
  });
});

describe("a well-read document passes; a partly-read one does not", () => {
  it("passes at the corpus's real coverage band", () => {
    for (const ratio of [0.72, 0.84, 0.89, 0.93, 0.95]) {
      const result = assessHoursCoverage(rowsTotalling(PRINTED_LABOR_HOURS * ratio), TOTALS);
      expect(result.gate).toBe(false);
    }
  });

  it("gates the partial-extraction case the line-span test cannot see", () => {
    // 22 of 64 priced lines recovered is ~34% of the hours.
    const result = assessHoursCoverage(rowsTotalling(PRINTED_LABOR_HOURS * 0.34), TOTALS);
    expect(result.gate).toBe(true);
    expect(result.coverage).toBeLessThan(0.5);
  });

  it("counts paint hours toward coverage, not only body labor", () => {
    const split = assessHoursCoverage([{ labor: 60, paint: 36.2 }], TOTALS);
    expect(split.parsedHours).toBeCloseTo(96.2, 1);
    expect(split.gate).toBe(false);
  });
});

describe("the gate stays inert where it cannot know", () => {
  it("does not fire when the document prints no labor hours", () => {
    const result = assessHoursCoverage([{ labor: 0, paint: 0 }], "ESTIMATE TOTALS\nParts1,000.00");
    expect(result.printedHours).toBe(0);
    expect(result.gate).toBe(false);
  });

  it("does not fire on a short estimate below the hour floor", () => {
    const short = "ESTIMATE TOTALS\nBody Labor4.0 hrs@$ 90.00 /hr360.00";
    expect(assessHoursCoverage([{ labor: 0.5, paint: 0 }], short).gate).toBe(false);
  });

  it("reads the totals block, not line rows that mention hours", () => {
    const withBody = `12 Repl Bumper cover 3.0 hrs\n${TOTALS}`;
    expect(assessHoursCoverage(rowsTotalling(PRINTED_LABOR_HOURS), withBody).printedHours).toBeCloseTo(
      PRINTED_LABOR_HOURS,
      1
    );
  });
});
