import { describe, expect, it } from "vitest";
import {
  looksLikeMitchellLayout,
  parseMitchellEstimateRows,
  parseMitchellEstimateTotals,
  unglue,
} from "../mitchellEstimateReader";
import { buildRekeySheet } from "../rekeyLedger";

/**
 * Synthetic, but in the layout a real Mitchell PDF actually extracts as:
 * every column welded to its neighbour, operations and part types wrapped
 * across physical lines, values printed twice in the totals, and section
 * headings sitting between rows with no marker of their own.
 */
const MITCHELL_TEXT = `Line #DescriptionOperationTypeTotal UnitsTypeNumberQtyTotal PriceTax
Front Bumper
1201423Frt Bumper Cover AssyOverhaulBody1.6#Existing
2201425Frt Upr Bumper CoverRepairBody3.0*#Existing
3AUTOFrt Upr Bumper CoverRefinish
Only
Refinish3.0 CExisting
4201402Frt Bumper Under CoverRemove /
Install
BodyINCr#Existing
Hood
10201467Hood Panel (Alum)RepairBody3.0*Existing
12201468Hood Adhesive EmblemRemove /
Replace
Body0.2New1694511-00-C1$65.00Yes
Special / Manual Entry
28900500CORROSION
PROTECTION
Additional
Labor
Body*0.2*SubletSublet1$15.00*
Estima te To ta ls
Body Labor11.411.4$90.00$90.00$21.00$21.00$1,047.00$1,047.00
Refinish Labor8.28.2$90.00$90.00$738.00$738.00
Mechanical Labor2.02.0$220.00$220.00$440.00$440.00
Taxable Parts$264.00$264.00$264.00$264.00
Paint Materials$344.40$344.40$344.40$344.40
      - Rate: $42.00
Tax 6.0000%$ 1 3 3 . 5 0$ 1 3 3 . 5 0
Gross Total$3,007.64$3,007.64$3,007.64
Deductible- $400.00- $400.00
`;

describe("Mitchell layout detection", () => {
  it("recognises the layout from its printed row anchor", () => {
    expect(looksLikeMitchellLayout(MITCHELL_TEXT)).toBe(true);
  });

  it("does not claim a CCC print is a Mitchell one", () => {
    expect(
      looksLikeMitchellLayout("FRONT BUMPER\n7O/H bumper assy1.6\n8R&I bumper coverIncl.\n9Rpr Bumper cover2.03.0\n")
    ).toBe(false);
  });
});

describe("ungluing welded columns", () => {
  it("separates a description from the operation that follows it", () => {
    expect(unglue("Frt Bumper Cover AssyOverhaulBody1.6#Existing")).toBe(
      "Frt Bumper Cover Assy Overhaul Body 1.6# Existing"
    );
  });

  it("keeps the platform's included-labor marker intact", () => {
    // Splitting on a single capital broke "INCr" into "IN Cr", which cost the
    // row its included flag.
    expect(unglue("BodyINCr#Existing")).toBe("Body INCr # Existing");
  });

  it("does not split a part number", () => {
    expect(unglue("NewTA12281031$182.00")).toContain("TA12281031");
  });
});

describe("Mitchell line items", () => {
  const rows = parseMitchellEstimateRows(MITCHELL_TEXT);
  const row = (line: number) => rows.find((candidate) => candidate.lineNumber === line);

  it("reads every printed row", () => {
    expect(rows.map((candidate) => candidate.lineNumber)).toEqual([1, 2, 3, 4, 10, 12, 28]);
  });

  it("reads an operation that wrapped across two printed lines", () => {
    expect(row(4)?.description).toMatch(/^Remove\s*\/?\s*Install/i);
    expect(row(12)?.description).toMatch(/^Remove\s*\/?\s*Replace/i);
  });

  it("reads hours against the right labor category", () => {
    expect(row(1)?.labor).toBe(1.6);
    expect(row(3)?.paint).toBe(3);
    expect(row(3)?.labor).toBeNull();
  });

  it("reads the included-labor marker", () => {
    expect(row(4)?.laborIncluded).toBe(true);
    expect(row(4)?.labor).toBeNull();
  });

  it("splits a quantity welded onto a part number when the split is unambiguous", () => {
    expect(row(12)?.partNumber).toBe("1694511-00-C");
    expect(row(12)?.qty).toBe(1);
    expect(row(12)?.price).toBe(65);
  });

  it("reads a price printed after a repeated part-type column", () => {
    expect(row(28)?.price).toBe(15);
    expect(row(28)?.partSource).toContain("SUBLET");
  });

  it("recovers the section headings printed between rows", () => {
    expect(row(1)?.section).toBe("Front Bumper");
    expect(row(10)?.section).toBe("Hood");
    expect(row(28)?.section).toMatch(/Special/);
  });

  it("carries the part type the row prints", () => {
    expect(row(12)?.partSource).toContain("NEW");
    expect(row(1)?.partSource).toContain("EXISTING");
  });
});

describe("Mitchell totals", () => {
  const totals = parseMitchellEstimateTotals(MITCHELL_TEXT);

  it("reads hours printed twice and run together", () => {
    const body = totals?.categories.find((entry) => entry.category === "Body Labor");
    expect(body).toEqual({ category: "Body Labor", hours: 11.4, rate: 90, cost: 1047 });
  });

  it("reads a category with no sublet column", () => {
    expect(totals?.categories.find((entry) => entry.category === "Refinish Labor")).toEqual({
      category: "Refinish Labor",
      hours: 8.2,
      rate: 90,
      cost: 738,
    });
  });

  it("attaches the paint materials rate printed apart from its amount", () => {
    const materials = totals?.categories.find((entry) => entry.category === "Paint Materials");
    expect(materials?.rate).toBe(42);
    expect(materials?.cost).toBe(344.4);
  });

  it("reads letter-spaced money and the deductible", () => {
    expect(totals?.tax).toBe(133.5);
    expect(totals?.grandTotal).toBe(3007.64);
    expect(totals?.deductible).toBe(400);
  });
});

describe("Mitchell estimate end to end", () => {
  const sheet = buildRekeySheet({ text: MITCHELL_TEXT, sourceFile: "mitchell.pdf" });

  it("builds a keyable sheet with a profile block", () => {
    expect(sheet.rows.length).toBeGreaterThan(0);
    expect(sheet.profile.find((field) => field.field === "Body rate (LAB)")?.value).toBe(90);
    expect(sheet.profile.find((field) => field.field === "Paint supplies rate (MAPA)")).toMatchObject({
      value: 42,
      basis: "printed",
    });
    expect(sheet.profile.find((field) => field.field === "Deductible")?.value).toBe(400);
  });

  it("translates the word-spelled operations into CCC vocabulary", () => {
    const operations = sheet.rows.map((row) => row.operationCcc);
    expect(operations).toContain("Repl");
    expect(operations).toContain("R&I");
    expect(operations).toContain("Rpr");
    expect(operations).toContain("O/H");
  });

  it("folds a refinish-only line into the part line above it", () => {
    expect(sheet.stats.foldedRefinishRows).toBe(1);
    expect(sheet.rows.some((row) => row.sourceLine === 3)).toBe(false);
  });

  it("carries the source totals as the target the keyed estimate must reach", () => {
    expect(sheet.expectedTotals?.grandTotal).toBe(3007.64);
  });
});
