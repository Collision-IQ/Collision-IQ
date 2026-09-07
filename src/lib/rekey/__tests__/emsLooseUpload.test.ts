import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isEmsCompanionFile, readEmsBundle } from "../emsReader";
import { keyedEstimateFromEms } from "../rekeyVerification";

/**
 * An EMS export selected as LOOSE FILES.
 *
 * CCC writes an EMS export as a dozen-plus dBase tables side by side in a
 * folder; there is no archive to pick. Requiring a ZIP made the verification
 * half of the rekey sheet unreachable from a real export — the estimator would
 * have had to build the archive first, and the single-file picker would not
 * even let them select the tables together.
 */
const dir = path.join(process.cwd(), "tests/fixtures/ems-ccc-1259209948");
const looseSelection = () =>
  fs
    .readdirSync(dir)
    .map((name) => ({ filename: name, bytes: new Uint8Array(fs.readFileSync(path.join(dir, name))) }));

describe("an EMS export picked as a folder of files", () => {
  it("reads the same export from loose files as from an archive", () => {
    const bundle = readEmsBundle(looseSelection());
    expect(bundle.errors).toEqual([]);
    const keyed = keyedEstimateFromEms(bundle, "loose selection");
    expect(keyed.ok).toBe(true);
    if (!keyed.ok) return;
    expect(keyed.estimate.lines.length).toBeGreaterThan(90);
    expect(keyed.estimate.totals.grandTotal).toBe(12138.16);
  });

  it("leaves out the companions that sit in the same folder", () => {
    // A real export folder also holds the estimate PDF and the workfile copy.
    // Neither is an EMS table, and reporting each as unreadable turned a good
    // export into a page of faults.
    expect(isEmsCompanionFile("CCC Estimate 1259209948.pdf")).toBe(true);
    expect(isEmsCompanionFile("1259209948.xml")).toBe(true);
    expect(isEmsCompanionFile("29508501.zip")).toBe(true);
    expect(isEmsCompanionFile("4b53232a.lin")).toBe(false);
    expect(isEmsCompanionFile("4b53232a.env")).toBe(false);
    expect(isEmsCompanionFile("4b53232a.pfm")).toBe(false);
  });

  it("passes over the workfile copy rather than reading it", () => {
    // WO-RK1 §1: no AWF is generated, read or reverse-engineered. A selection
    // that includes one still verifies, and the AWF contributes nothing.
    const withWorkfile = [
      ...looseSelection(),
      { filename: "4b53232a.AWF", bytes: new Uint8Array([1, 2, 3, 4]) },
    ];
    const bundle = readEmsBundle(withWorkfile);
    expect(bundle.errors).toEqual([]);
    expect(bundle.tableNames).not.toContain("awf");
  });
});
