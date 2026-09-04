import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { assessRekeySheet, buildRekeySheet } from "../rekeyLedger";
import { readEmsBundle } from "../emsReader";
import { keyedEstimateFromEms, verifyRekey } from "../rekeyVerification";

/**
 * F-RK1b: the real Mitchell SUPPLEMENT (RO 21011) whose CCC EMS export is
 * already the F-RK1a fixture, so the two halves of the real verification use
 * case are both in the repository.
 *
 * Every number asserted here is the WO-RK1 reference packet's ground truth for
 * this document (docs/reference/wo-rk1/tests/test_fixture_21011.py): hours by
 * type, parts total, folded rows, note lines, gross total. Before this fixture
 * the supplement tag the print welds ahead of each line number ("S12200886…")
 * failed the row anchor, and every tagged row was joined onto the row above
 * it — the sheet carried 13.8 of 21.3 body hours and half the parts.
 */
const TEXT = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/frk1b-mitchell-text.txt"), "utf8");
const sheet = buildRekeySheet({ text: TEXT, sourceFile: "frk1b.pdf" });
const row = (line: number) => sheet.rows.find((candidate) => candidate.sourceLine === line);

const hours = (type: string) =>
  Math.round(
    sheet.rows
      .flatMap((candidate) => candidate.labor)
      .filter((entry) => entry.type === type && !entry.included)
      .reduce((total, entry) => total + entry.hours, 0) * 10
  ) / 10;

describe("F-RK1b — a real supplement print", () => {
  it("reads the supplement tag welded ahead of the line number", () => {
    expect(row(2)?.supplementTag).toBe("S1");
    expect(row(12)?.supplementTag).toBe("S2");
    expect(row(13)?.supplementTag).toBeNull();
  });

  it("bills the hours the reference packet proved", () => {
    expect([hours("LAB"), hours("LAR"), hours("LAM")]).toEqual([21.3, 16.7, 6.8]);
  });

  it("closes every printed total from its own rows and passes the gate", () => {
    expect(sheet.reconciliation.failures).toEqual([]);
    const parts = sheet.reconciliation.rows.find((entry) => entry.category === "Parts");
    expect(parts).toMatchObject({ printed: 6594.49, derived: 6594.49, closes: true });
    expect(sheet.expectedTotals?.grandTotal).toBe(11262.38);
    expect(assessRekeySheet(sheet).ok).toBe(true);
  });

  it("folds the seven refinish lines the packet folds, and keys the four notes", () => {
    expect(sheet.stats.foldedRefinishRows).toBe(7);
    expect(row(24)?.notes).toContain("Reconcile with invoice");
    expect(row(26)?.notes).toContain("align");
    expect(row(28)?.notes).toContain("align");
    expect(row(81)?.notes).toContain("For primer");
    expect([25, 27, 29, 82].map(row)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("reads a description that ends in the platform's labor marker", () => {
    // "Cooling Unit Assy -MRemove / Install" — the marker was welded to the
    // operation and the row lost its operation.
    expect(row(11)?.operationCcc).toBe("R&I");
    expect(sheet.stats.unmappedOperations).toBe(0);
  });
});

describe("F-RK1b against F-RK1a — the real verification pair", () => {
  const dir = path.join(process.cwd(), "tests/fixtures/ems-rk1a");
  const files = fs
    .readdirSync(dir)
    .map((name) => ({ filename: name, bytes: new Uint8Array(fs.readFileSync(path.join(dir, name))) }));
  const keyed = keyedEstimateFromEms(readEmsBundle(files), "ab7f6e93.zip");
  if (!keyed.ok) throw new Error(keyed.reason);
  const verification = verifyRekey({ sheet, keyed: keyed.estimate });

  it("confirms the pair on VIN and on a claim number printed with a revision suffix", () => {
    expect(verification.identity.verdict).toBe("match");
    expect(verification.identity.detail).toMatch(/agrees/);
  });

  it("reports the profile differences first, with the markup as a percentage", () => {
    const fields = verification.profileFindings.map((finding) => `${finding.field}: ${finding.found}`);
    expect(fields).toContain("Body rate (LAB): $75.00");
    expect(fields).toContain("Paint supplies rate (MAPA): $60.00");
    expect(fields).toContain("Parts markup (PAL): 25%");
  });

  it("does not pass — the export is the shop's own prelim, not the rekey", () => {
    expect(verification.summary.pass).toBe(false);
  });
});
