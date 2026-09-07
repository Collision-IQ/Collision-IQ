import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildRekeySheet } from "../rekeyLedger";
import { parseMitchellEstimateTotals } from "../mitchellEstimateReader";

const read = (name: string) => fs.readFileSync(path.join(process.cwd(), "tests/fixtures", name), "utf8");
const FRK1B = read("frk1b-mitchell-text.txt");
const FRK2 = read("frk2-mitchell-text.txt");
const FRK3 = read("frk3-mitchell-shapes.txt");
const deductible = (text: string) =>
  buildRekeySheet({ text, sourceFile: "x.pdf" }).profile.find((field) => field.field === "Deductible");

/**
 * RS-12 — the deductible, and only the deductible.
 *
 * Three rows on a supplemented print begin with the word: the adjustments
 * row that states the figure, a "Deductible Reduction Credit" row, and the
 * Global Changes block's per-supplement history. Matching the label as a
 * prefix took all three, and because the credit prints last it won — so an
 * estimate carrying a $500.00 deductible reported $0.00, and the customer
 * responsibility an estimator keys from was short by the whole deductible.
 */
describe("RS-12 — the deductible row is the one whose label is the word itself", () => {
  it("reads a waived deductible as a stated zero, not as unknown", () => {
    expect(deductible(FRK1B)).toMatchObject({ value: 0, display: "Waived / $0.00", basis: "printed" });
  });

  it("reads a plain adjustments deductible", () => {
    expect(deductible(FRK3)).toMatchObject({ value: 500, basis: "printed" });
  });

  it("says nothing rather than guessing when the print states none", () => {
    expect(deductible(FRK2)).toMatchObject({ value: null, display: "not printed", basis: "unavailable" });
  });

  it("does not read a deductible reduction credit as the deductible", () => {
    const withCredit = FRK1B.replace(
      "Deductible Reduction CreditDeductible Reduction Credit$0.00$0.00$0.00$0.00",
      "Deductible Reduction CreditDeductible Reduction Credit$250.00$250.00$250.00$250.00"
    );
    expect(withCredit).not.toBe(FRK1B);
    expect(parseMitchellEstimateTotals(withCredit)?.deductible).toBe(0);
    expect(deductible(withCredit)?.value).toBe(0);
  });

  it("does not let a later credit row overwrite a real deductible", () => {
    const withReal = FRK1B.replace("DeductibleWaivedWaivedWaivedWaived", "DeductibleDeductible$500.00$500.00");
    expect(withReal).not.toBe(FRK1B);
    expect(deductible(withReal)).toMatchObject({ value: 500, basis: "printed" });
  });

  it("does not take the per-supplement history as the figure to key", () => {
    // The Global Changes block states $1,000.00 under S1. It is history: the
    // adjustments row is what the estimate holds now.
    expect(parseMitchellEstimateTotals(FRK1B)?.deductibleChanges).toEqual([
      { tag: "S1", amount: 1000 },
      { tag: "S2", amount: 0 },
    ]);
    expect(deductible(FRK1B)?.value).toBe(0);
  });

  it("states the change on the field, because it moves customer responsibility", () => {
    expect(deductible(FRK1B)?.note).toBe(
      "Changed by supplement: S1 $1000.00 -> S2 $0.00. Confirm which applies before keying."
    );
    // An estimate with no supplement history says nothing extra.
    expect(deductible(FRK3)?.note).toBeUndefined();
  });
});

/**
 * RS-6 / RK-05 — a coded note is an instruction to the person keying.
 *
 * The print gives a note its own line number and its own coded row, and the
 * reader once carried it through as a keying row — which took the operation
 * of the line above it, so the sheet told an estimator to key "Repl" against
 * a sentence of prose.
 */
describe("RS-6 — a note row is never a keying row", () => {
  const noteCodeLines = (text: string) =>
    [...text.matchAll(/(?:^|\n)(?:S\d\s*)?(\d{1,3})900501/g)].map((match) => Number(match[1]));

  it("produces no row at any note line on either real document", () => {
    for (const text of [FRK1B, FRK2]) {
      const sheet = buildRekeySheet({ text, sourceFile: "x.pdf" });
      const lines = noteCodeLines(text);
      expect(lines.length).toBeGreaterThan(3);
      for (const line of lines) {
        expect(sheet.rows.find((row) => row.sourceLine === line)).toBeUndefined();
      }
    }
  });

  it("attaches the note to the row above it, leaving that row's own operation", () => {
    const sheet = buildRekeySheet({ text: FRK2, sourceFile: "frk2.pdf" });
    const attached = (line: number) => sheet.rows.find((row) => row.sourceLine === line);
    // Note 9 belongs to row 8, note 69 to row 68 — each keeps the operation
    // the print gave IT, not the note's.
    expect(attached(8)).toMatchObject({ operationCanonical: "Rpr" });
    expect(attached(8)?.notes.join(" ")).toContain("Pre-fit prior to refinish");
    expect(attached(68)).toMatchObject({ operationCanonical: "Rpr" });
    expect(attached(68)?.notes.join(" ")).toContain("D&R Electric");
  });

  it("counts the note lines so the sheet's line accounting still closes", () => {
    const sheet = buildRekeySheet({ text: FRK2, sourceFile: "frk2.pdf" });
    expect(sheet.stats.noteLines).toBe(noteCodeLines(FRK2).length);
    const { keyableRows, foldedRefinishRows, noteLines, nonKeyableRows } = sheet.stats;
    expect(keyableRows + foldedRefinishRows + noteLines + nonKeyableRows).toBe(93);
  });
});
