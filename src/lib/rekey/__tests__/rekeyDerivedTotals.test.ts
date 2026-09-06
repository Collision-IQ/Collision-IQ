import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildRekeySheet, deriveRekeyTotals, reconcileRekeySheet } from "../rekeyLedger";
import { buildRekeySheetText } from "../rekeyReportBuilder";
import { SOURCE_ESTIMATE_TEXT } from "./fixtures";

/**
 * RS-2 — the totals block is computed from the rows, not copied from the print.
 *
 * The defect this closes is subtle and was invisible from the sheet itself:
 * the "should read" block was the source's own totals page, so it agreed with
 * the source whatever the rows above it said. A sheet that had lost a labor
 * line still printed the gross the estimator would never reach by keying it.
 *
 * The check below that matters most is the last one: remove a row and the
 * derived gross has to move. A block that still agrees with the print after a
 * row is deleted is a copy, whatever it is labelled.
 */
const FRK2 = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/frk2-mitchell-text.txt"), "utf8");
const frk2 = buildRekeySheet({ text: FRK2, sourceFile: "frk2.pdf" });
const category = (name: string) => frk2.derivedTotals?.categories.find((entry) => entry.category === name);

describe("RS-2 — a real Mitchell estimate derives its own gross", () => {
  it("lands on the printed gross to the cent", () => {
    expect(frk2.derivedTotals?.grandTotal).toBe(12496.54);
    expect(frk2.derivedTotals?.check).toMatchObject({ printedGrandTotal: 12496.54, delta: 0, closes: true });
  });

  it("prices labor from the rows' hours at the profile's rate", () => {
    expect(category("Body Labor")).toMatchObject({ hours: 24.6, rate: 75, extra: 10, cost: 1855, fromRows: true });
    expect(category("Refinish Labor")).toMatchObject({ hours: 15.2, rate: 75, cost: 1140, fromRows: true });
    expect(category("Mechanical Labor")).toMatchObject({ hours: 0.2, rate: 75, extra: 569.5, cost: 584.5 });
  });

  it("prices paint materials as refinish units at the materials rate", () => {
    expect(category("Paint Materials")).toMatchObject({ hours: 15.2, unit: "units", rate: 60, cost: 912, fromRows: true });
  });

  it("adds parts from the rows' own extended prices", () => {
    expect(category("Parts")).toMatchObject({ cost: 7023.83, fromRows: true });
  });

  it("names the one figure it carries from the print instead of deriving", () => {
    // The markup RATE was back-derived from the printed amount, so recomputing
    // the amount from it would agree by construction. It is carried and said.
    expect(category("Parts Adjustments")).toMatchObject({ cost: 273.86, fromRows: false });
    expect(frk2.derivedTotals?.check.caveats).toHaveLength(1);
    expect(frk2.derivedTotals?.check.caveats[0]).toMatch(/Parts Adjustments/);
  });

  it("taxes the derived subtotal at the rate the source's own print proves", () => {
    expect(frk2.derivedTotals?.taxRate?.rate).toBeCloseTo(0.06, 6);
    expect(frk2.derivedTotals?.tax).toBe(707.35);
  });

  it("shows both blocks on the sheet, each labelled for what it is", () => {
    const text = buildRekeySheetText(frk2);
    expect(text).toContain("THE KEYED ESTIMATE SHOULD READ — FROM THE ROWS ABOVE, AT THE PROFILE ABOVE");
    expect(text).toContain("THE SOURCE ESTIMATE PRINTS");
    expect(text).toContain("Check: the source prints $12496.54 — difference 0.00");
  });

  it("puts the gross on the reconciliation as one line", () => {
    const gross = frk2.reconciliation.rows.find((row) => row.category === "Gross total");
    expect(gross).toMatchObject({ printed: 12496.54, derived: 12496.54, closes: true });
    expect(frk2.reconciliation.failures).toEqual([]);
  });
});

describe("RS-2 — the block moves when the rows move", () => {
  const withoutBumperCover = frk2.rows.filter((row) => row.sourceLine !== 5);
  const derived = deriveRekeyTotals({
    rows: withoutBumperCover,
    profile: frk2.profile,
    printed: frk2.expectedTotals,
    mitchellLayout: true,
  });

  it("loses the row's part dollars and refinish hours from the gross", () => {
    // Line 5 is the front bumper cover: $508.80 of parts and the 2.8 refinish
    // hours folded onto it, which also cost 2.8 units of paint materials.
    expect(derived?.categories.find((entry) => entry.category === "Parts")?.cost).toBe(6515.03);
    expect(derived?.categories.find((entry) => entry.category === "Refinish Labor")?.hours).toBe(12.4);
    expect(derived?.grandTotal).toBeLessThan(12496.54);
  });

  it("fails the check against the printed gross", () => {
    expect(derived?.check.closes).toBe(false);
    expect(derived?.check.delta).not.toBe(0);
  });

  it("reports the gap as a reconciliation failure, not a footnote", () => {
    const reconciliation = reconcileRekeySheet({
      rows: withoutBumperCover,
      totals: frk2.expectedTotals,
      derived,
      unreadLines: [],
      mitchellLayout: true,
    });
    expect(reconciliation.closes).toBe(false);
    expect(reconciliation.failures.some((failure) => /^Gross total:/.test(failure))).toBe(true);
  });
});

describe("RS-2 — a rate the source never printed cannot fail the check on rounding", () => {
  // This CCC fixture prints paint supplies as a flat amount, so the materials
  // rate is recovered by division and rounded to the cent — the rate the
  // estimator types. Multiplying it back cannot land on the printed amount
  // exactly, and a nickel of that is not a sheet that will not close.
  const sheet = buildRekeySheet({ text: SOURCE_ESTIMATE_TEXT, sourceFile: "ccc.pdf" });

  it("closes within the rounding the derived rate forces, and no wider", () => {
    expect(sheet.profile.find((field) => field.field === "Paint supplies rate (MAPA)")?.basis).toBe("derived");
    expect(sheet.derivedTotals?.check.closes).toBe(true);
    expect(Math.abs(sheet.derivedTotals?.check.delta ?? 1)).toBeLessThan(0.06);
    expect(sheet.reconciliation.failures).toEqual([]);
  });
});
