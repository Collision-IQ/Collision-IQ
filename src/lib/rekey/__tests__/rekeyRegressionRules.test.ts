import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildRekeySheet } from "../rekeyLedger";
import { stripCegSuffix, unglue } from "../mitchellEstimateReader";
import { partNumberKey } from "../rekeyVerification";

/**
 * Named regression rules from the RK-T1 accuracy review.
 *
 * The fixture is the extracted text of a real Mitchell estimate whose print
 * carries a CEG column — a column the reader had never seen. Its absence from
 * the earlier fixture is exactly why this shipped: the units cell and the CEG
 * cell arrive welded together, and a units pattern that does not expect the
 * second value matches neither.
 */
const TEXT = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/frk2-mitchell-text.txt"), "utf8");
const sheet = buildRekeySheet({ text: TEXT, sourceFile: "frk2.pdf" });

const hours = (type: string) =>
  Math.round(
    sheet.rows
      .flatMap((row) => row.labor)
      .filter((entry) => entry.type === type && !entry.included)
      .reduce((total, entry) => total + entry.hours, 0) * 10
  ) / 10;

describe("RK-01 — units flag strip and the CEG column", () => {
  it("bills the hours the estimate bills, read from the rows", () => {
    // Before this rule the sheet carried 3.1 of these 24.6 body hours.
    expect(hours("LAB")).toBe(24.6);
    expect(hours("LAR")).toBe(15.2);
  });

  it("agrees with the printed totals page", () => {
    const printed = sheet.expectedTotals?.categories ?? [];
    expect(printed.find((c) => /body/i.test(c.category))?.hours).toBe(hours("LAB"));
    expect(printed.find((c) => /refinish/i.test(c.category))?.hours).toBe(hours("LAR"));
  });

  it("removes a CEG value welded to the units cell, and nothing else", () => {
    expect(stripCegSuffix("2.6#2.6")).toBe("2.6#");
    expect(stripCegSuffix("INC#0.2")).toBe("INC#");
    expect(stripCegSuffix("*0.3*0.0")).toBe("*0.3*");
    // A units cell with no CEG welded to it is left alone.
    expect(stripCegSuffix("2.6#")).toBe("2.6#");
    expect(stripCegSuffix("INC")).toBe("INC");
  });
});

describe("RK-04 — sections are line-band text anywhere on the page", () => {
  it("recovers every section the estimate prints", () => {
    const sections = [...new Set(sheet.rows.map((row) => row.sectionSource))];
    expect(sections).toEqual([
      "Information Labels",
      "Front Bumper",
      "Grille",
      "Front Lamps",
      "Hood",
      "Front Fender",
      "Front Inner Structure",
      "Air Cleaner",
      "Electrical",
      "Rear Bumper",
      "Additional Costs Materials",
      "Additional Operations",
    ]);
  });

  it("does not read page furniture as a section", () => {
    // "System profile" prints immediately above a heading on each new page and
    // was being joined onto it ("System profile Grille").
    expect(sheet.rows.some((row) => /system profile/i.test(row.sectionSource ?? ""))).toBe(false);
  });

  it("leaves almost nothing unmapped", () => {
    expect(sheet.stats.unmappedSections).toBeLessThanOrEqual(3);
  });
});

describe("RK-07 — quantity and unit price", () => {
  it("takes the quantity the description declares and prices per unit", () => {
    // "Frt Bumper Clip (2 @ $1.98)" bills $3.96 for two.
    const multi = sheet.rows.find((row) => row.sourceLine === 16);
    expect(multi?.qty).toBe(2);
    expect(multi?.price).toBe(1.98);
    // The column spelled into the description is removed once read.
    expect(multi?.descriptionCcc).toBe("Frt Bumper Clip");
  });

  it("separates a quantity welded onto the part number", () => {
    const byLine = (line: number) => sheet.rows.find((row) => row.sourceLine === line);
    expect(byLine(1)?.partNumber).toBe("88723-06130");
    expect(byLine(3)?.partNumber).toBe("15369-0P010");
    expect(byLine(17)?.partNumber).toBe("52021-06190");
    expect(byLine(17)?.qty).toBe(1);
    expect(byLine(17)?.price).toBe(392.7);
  });

  it("keeps a part number whose quantity stood in its own column", () => {
    // A wrapped number leaves the quantity as its own token, which proves it
    // was never welded on — so nothing may be stripped from the number.
    const clip = sheet.rows.find((row) => row.sourceLine === 22);
    expect(clip?.qty).toBe(4);
    expect(clip?.price).toBe(1.98);
    // The wrapped number is rejoined, so nothing is stripped from it.
    expect(clip?.partNumber).toBe("90467-07049-23");
  });
});

describe("RK-08 — part-number key", () => {
  it("keys on alphanumerics so the two platforms' spellings meet", () => {
    expect(partNumberKey("53101-06650")).toBe("5310106650");
    expect(partNumberKey("5310106650")).toBe("5310106650");
    expect(partNumberKey("M1PZ 17E810 AA")).toBe("M1PZ17E810AA");
  });

  it("refuses a value too short to identify a part", () => {
    expect(partNumberKey("--")).toBeNull();
    expect(partNumberKey("")).toBeNull();
    expect(partNumberKey(null)).toBeNull();
  });
});
