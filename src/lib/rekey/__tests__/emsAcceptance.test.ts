import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { gateEmsEstimate, normalizeEmsEstimate, readEmsBundle, readTaxRate } from "../emsReader";

/**
 * F-RK1a — the work order's reader acceptance fixture (WO-RK1 §6).
 *
 * A REAL CCC EMS v2.01 export. Everything the reader knew about field names
 * before this fixture arrived was inferred from the spec, and most of it was
 * wrong in ways nothing synthetic could show: a line's part number, price and
 * hours each live under a name the guesses did not carry, and the subtotal
 * table keys its categories on a column the reader was not reading at all.
 *
 * The expected values below are the work order's own acceptance numbers, so
 * this file is the contract, not a snapshot of current behaviour.
 *
 * The AWF in the source export is deliberately absent: §1 puts it out of
 * scope, and it is neither read nor parsed anywhere in this module.
 */
const FIXTURE = path.join(process.cwd(), "tests/fixtures/ems-rk1a");

function loadFixture() {
  const files = fs
    .readdirSync(FIXTURE)
    .filter((name) => name.startsWith("ab7f6e93."))
    .map((name) => ({
      filename: name,
      bytes: new Uint8Array(fs.readFileSync(path.join(FIXTURE, name))),
    }));
  return readEmsBundle(files);
}

const bundle = loadFixture();
const estimate = normalizeEmsEstimate(bundle);
const subtotal = (code: string) => estimate.subtotals.find((entry) => entry.code === code);

describe("F-RK1a — real CCC EMS export", () => {
  it("reads every table without error and passes the gate", () => {
    expect(bundle.errors).toEqual([]);
    expect(gateEmsEstimate(estimate)).toEqual({ ok: true });
    expect(estimate.estimatingSystem).toBe("C");
    expect(estimate.emsVersion).toBe("2.01");
  });

  it("collapses 176 labor records into 168 estimate lines", () => {
    expect(estimate.recordCounts.lin).toBe(176);
    expect(estimate.lines).toHaveLength(168);
  });

  it("reaches the printed gross and tax", () => {
    expect(estimate.totals.grandTotal).toBe(19517.9);
    expect(estimate.totals.tax).toBe(1083.93);
  });

  it("separates body from refinish, which the group column cannot", () => {
    // TTL_TYPE reads "LA" for both; only TTL_TYPECD distinguishes them.
    expect(subtotal("LAB")).toMatchObject({ hours: 47.7, amount: 3577.5 });
    expect(subtotal("LAR")).toMatchObject({ hours: 21.7, amount: 1627.5 });
    expect(subtotal("PAT")?.amount).toBe(11926.97);
  });

  it("drops the empty category rows a CCC export always writes", () => {
    expect(estimate.subtotals.every((entry) => (entry.hours ?? 0) !== 0 || (entry.amount ?? 0) !== 0)).toBe(true);
    expect(estimate.subtotals.length).toBeLessThan(20);
  });

  it("reads the part number, billed price and billed hours off a real line", () => {
    const line = estimate.lines.find((entry) => entry.lineNumber === 7);
    expect(line?.partNumber).toBe("M1PZ17626B");
    expect(line?.partType).toBe("PAN");
    // ACT_PRICE is what the estimate bills; DB_PRICE on this line is 566.25.
    expect(line?.price).toBe(560.28);
    // An included operation bills no time even though the database says 4.6.
    expect(line?.labor[0]).toMatchObject({ type: "LAB", hours: 0, included: true, opCode: "OP11" });
  });

  it("reads enough lines to be usable, not just enough to parse", () => {
    expect(estimate.lines.filter((line) => line.partNumber).length).toBeGreaterThan(80);
    expect(estimate.lines.filter((line) => (line.price ?? 0) > 0).length).toBeGreaterThan(50);
    expect(estimate.lines.filter((line) => line.labor.some((e) => (e.hours ?? 0) > 0)).length).toBeGreaterThan(90);
  });
});

describe("F-RK1a — profile, the settings a rekey must match", () => {
  it("reads the labor rates", () => {
    expect(estimate.profile.laborRates.find((r) => r.code === "LAB")?.rate).toBe(75);
    expect(estimate.profile.laborRates.find((r) => r.code === "LAR")?.rate).toBe(75);
  });

  it("reads the paint materials rate, which sits under MATL_TYPE", () => {
    expect(estimate.profile.materialsRate).toBe(60);
  });

  it("reads the tiered tax table rather than a flat rate field", () => {
    expect(estimate.profile.taxRate).toBe(6);
    expect(readTaxRate(undefined)).toBeNull();
  });

  it("surfaces the recycled-parts markup the work order warns must be zeroed", () => {
    // §3.5: a 25% markup on PAL inflates every recycled part in a rekey.
    expect(estimate.profile.partsMarkups.find((m) => m.code === "PAL")?.markupPct).toBe(0.25);
  });
});

describe("EMS bundle hygiene", () => {
  it("skips the dBase memo side-file without calling the export faulty", () => {
    const withMemo = readEmsBundle([
      ...fs.readdirSync(FIXTURE).map((name) => ({
        filename: name,
        bytes: new Uint8Array(fs.readFileSync(path.join(FIXTURE, name))),
      })),
      { filename: "ab7f6e93.dbt", bytes: new Uint8Array([0x03, 0x00, 0x00]) },
    ]);
    expect(withMemo.errors).toEqual([]);
    expect(withMemo.tableNames).not.toContain("dbt");
  });
});
