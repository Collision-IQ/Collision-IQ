import { describe, expect, it } from "vitest";
import { extractDtcs, detectDtcStatus } from "@/lib/scans/dtcExtractor";
import { parseScanReport } from "@/lib/scans/scanParser";

const SAMPLE_SCAN = `
asTech Remote Diagnostics Report
Scan Date: 03/11/2026 09:15 AM
2010 Honda Civic
VIN: 19XFA1F51AE028415

ECM - Engine Control Module
P0301 - Cylinder 1 Misfire Detected - ACTIVE
P0420 Catalyst System Efficiency Below Threshold (Bank 1) STORED

SRS - Supplemental Restraint System
B1342:08 ECU Internal Failure PENDING

BCM (Body Control)
U0121-00 Lost Communication With ABS Module - HISTORY
C0035 Left Front Wheel Speed Sensor
`;

describe("dtcExtractor", () => {
  const { dtcs, modules } = extractDtcs({ text: SAMPLE_SCAN, sourceFile: "pre.pdf", side: "pre" });

  it("finds P/B/C/U codes including suffixed manufacturer variants", () => {
    const codes = dtcs.map((dtc) => dtc.normalizedCode);
    expect(codes).toContain("P0301");
    expect(codes).toContain("P0420");
    expect(codes).toContain("B1342");
    expect(codes).toContain("U0121");
    expect(codes).toContain("C0035");
    // Exact codes keep suffixes.
    expect(dtcs.map((d) => d.code)).toContain("U0121-00");
    expect(dtcs.map((d) => d.code)).toContain("B1342-08");
  });

  it("preserves module names where present", () => {
    const byCode = new Map(dtcs.map((dtc) => [dtc.normalizedCode, dtc]));
    expect(byCode.get("P0301")?.module).toContain("ECM");
    expect(byCode.get("B1342")?.module).toContain("SRS");
    expect(byCode.get("U0121")?.module).toContain("BCM");
    expect(modules.length).toBeGreaterThanOrEqual(3);
  });

  it("captures status and description and line references", () => {
    const p0301 = dtcs.find((dtc) => dtc.normalizedCode === "P0301");
    expect(p0301?.status).toBe("active");
    expect(p0301?.originalDescription).toContain("Cylinder 1 Misfire");
    expect(p0301?.lineReference).toBeGreaterThan(0);
    expect(dtcs.find((dtc) => dtc.normalizedCode === "P0420")?.status).toBe("stored");
    expect(dtcs.find((dtc) => dtc.normalizedCode === "U0121")?.status).toBe("history");
  });

  it("detectDtcStatus maps common vendor wording", () => {
    expect(detectDtcStatus("code is CURRENT")).toBe("active");
    expect(detectDtcStatus("PERMANENT dtc")).toBe("permanent");
    expect(detectDtcStatus("no keywords")).toBe("unknown");
  });
});

describe("scanParser", () => {
  it("extracts VIN, YMM, vendor, and date", () => {
    const parsed = parseScanReport({ text: SAMPLE_SCAN, sourceFile: "pre.pdf", side: "pre" });
    expect(parsed.vin).toBe("19XFA1F51AE028415");
    expect(parsed.year).toBe(2010);
    expect(parsed.make).toBe("Honda");
    expect(parsed.scannerVendor).toBe("asTech");
    expect(parsed.scanDate).toContain("03/11/2026");
    expect(parsed.unreadable).toBe(false);
    expect(parsed.dtcs.length).toBeGreaterThan(0);
  });

  it("empty or unreadable scan returns a safe result instead of throwing", () => {
    const parsed = parseScanReport({ text: "", sourceFile: "blank.pdf", side: "post" });
    expect(parsed.unreadable).toBe(true);
    expect(parsed.dtcs).toHaveLength(0);
    expect(parsed.warnings[0]).toContain("No readable text");
  });
});
