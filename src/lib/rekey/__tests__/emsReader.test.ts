import { describe, expect, it } from "vitest";
import { gateEmsEstimate, normalizeEmsEstimate, parseDbaseTable, readEmsBundle } from "../emsReader";
import { buildEmsExportFiles, writeDbaseTable } from "./emsFixture";

describe("EMS dBase reader", () => {
  it("takes its layout from the file header, not from fixed offsets", () => {
    const bytes = writeDbaseTable(
      [
        { name: "WIDE_TEXT", type: "C", length: 30 },
        { name: "AMOUNT", type: "N", length: 12, decimals: 2 },
        { name: "FLAG", type: "L", length: 1 },
      ],
      [{ WIDE_TEXT: "value one", AMOUNT: 1234.56, FLAG: true }]
    );
    const table = parseDbaseTable("xyz", bytes);
    expect(table?.fields.map((field) => field.name)).toEqual(["WIDE_TEXT", "AMOUNT", "FLAG"]);
    expect(table?.records[0]).toEqual({ WIDE_TEXT: "value one", AMOUNT: 1234.56, FLAG: true });
  });

  it("returns null for a file that is not a dBase table instead of throwing", () => {
    expect(parseDbaseTable("txt", new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("keys tables by their CIECA extension and reports unreadable files", () => {
    const bundle = readEmsBundle([
      ...buildEmsExportFiles(),
      { filename: "readme.txt", bytes: new Uint8Array([0, 0, 0, 0]) },
    ]);
    expect(bundle.tableNames).toContain("lin");
    expect(bundle.tableNames).toContain("env");
    expect(bundle.errors.join(" ")).toMatch(/readme\.txt/);
  });

  it("collapses multi-record lines into one line with a labor array", () => {
    const estimate = normalizeEmsEstimate(readEmsBundle(buildEmsExportFiles()));
    expect(estimate.lines).toHaveLength(2);
    const hood = estimate.lines[0];
    expect(hood.partNumber).toBe("FO1230344C");
    expect(hood.recordCount).toBe(2);
    expect(hood.labor.map((entry) => entry.type)).toEqual(["LAB", "LAR"]);
    expect(hood.labor.map((entry) => entry.hours)).toEqual([1.6, 7]);
  });

  it("reads identity, subtotals, totals and profile", () => {
    const estimate = normalizeEmsEstimate(readEmsBundle(buildEmsExportFiles()));
    expect(estimate.vin).toBe("1FTFW1E84PKE00000");
    expect(estimate.claimNumber).toBe("TESTCLAIM0001");
    expect(estimate.emsVersion).toBe("2.01");
    expect(estimate.totals).toEqual({ tax: 182.02, grandTotal: 3215.62 });
    expect(estimate.subtotals.find((entry) => entry.code === "LAR")).toEqual({
      code: "LAR",
      hours: 10.1,
      amount: 616.1,
    });
    expect(estimate.profile.materialsRate).toBe(96.08);
    expect(estimate.profile.laborRates).toContainEqual({ code: "LAB", rate: 61 });
  });
});

describe("EMS gate — fails closed", () => {
  it("refuses an export with no line records", () => {
    const estimate = normalizeEmsEstimate(readEmsBundle(buildEmsExportFiles({ emptyLines: true })));
    const gate = gateEmsEstimate(estimate);
    expect(gate.ok).toBe(false);
    expect(gate.reason).toMatch(/no estimate lines/i);
  });

  it("refuses an export that identifies no estimating system", () => {
    const files = buildEmsExportFiles().filter((file) => !file.filename.endsWith(".env"));
    const gate = gateEmsEstimate(normalizeEmsEstimate(readEmsBundle(files)));
    expect(gate.ok).toBe(false);
    expect(gate.reason).toMatch(/estimating system/i);
  });
});
