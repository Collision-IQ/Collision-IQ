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

// BMW formats (RO 22009): asTech-on-BMW prints 0x-prefixed 6-hex codes under
// colon-terminated module headings with "Not present" status; ISTA "Fault
// code memory list" printouts start each row with a BARE 6-hex code that is
// often pure digits — only extracted when the document identifies as a BMW
// fault list.
const ASTECH_BMW_SCAN = `
Pre-Repair Scan
Vehicle2022 BMW X5
SRS DeploymentNo
Warning LightsNo
Performed a full pre-repair scan Health Check with the ISTA scan tool.
Scan Readings
Optional Extra Equipment:
0xD1EE23 - Signal (environmental model, object detection) invalid, transmitter FRSF - Not present
Front Radar Sensor Long Range:
0x482136 - ACC sensor/FRSF: Maladjustment - Not present
0x48214A - ACC sensor/FRSF: Lack of visibility - Not present
Electrical Machine Electronics:
0x030EC8 - Charge management function: no voltage after charging began - Not present
`;

const ISTA_FAULT_LIST = `
Fault code memory list VIN: 5UXTA6C04N9M51734 14.07.2026, 14:10:07 - 1/4
022345 SAS: Voltage supply - global external undervoltage 83219 No Information
0300B1 Power window regulator, passenger's side: Hardware fault 83219 No Battery
0316D1 High-voltage battery unit: Category 1 fault 83219 yes Information
`;

describe("dtcExtractor BMW/asTech formats (RO 22009)", () => {
  const astech = extractDtcs({ text: ASTECH_BMW_SCAN, sourceFile: "astech-pre.pdf", side: "pre" });

  it("extracts 0x-prefixed 6-hex BMW codes with their modules", () => {
    const codes = astech.dtcs.map((dtc) => dtc.normalizedCode);
    expect(codes).toContain("D1EE23");
    expect(codes).toContain("482136");
    expect(codes).toContain("48214A");
    expect(codes).toContain("030EC8");
    const radar = astech.dtcs.find((dtc) => dtc.normalizedCode === "482136");
    expect(radar?.module).toBe("Front Radar Sensor Long Range");
  });

  it("maps BMW 'Not present' to stored, never active", () => {
    for (const dtc of astech.dtcs) {
      expect(dtc.status).toBe("stored");
    }
  });

  it("never treats glued header key/values as module headings", () => {
    expect(astech.modules).not.toContain("SRS DeploymentNo");
    expect(astech.modules.some((module) => /deployment|warning lights/i.test(module))).toBe(false);
  });

  it("extracts bare line-start codes (even pure-digit) from an ISTA fault code memory list", () => {
    const ista = extractDtcs({ text: ISTA_FAULT_LIST, sourceFile: "sas-post.pdf", side: "post" });
    const codes = ista.dtcs.map((dtc) => dtc.normalizedCode);
    expect(codes).toContain("022345");
    expect(codes).toContain("0300B1");
    expect(codes).toContain("0316D1");
  });

  it("does NOT extract bare 6-digit numbers from documents that are not BMW fault lists", () => {
    const estimateText = "148305 Repl Storage compart 149294500C 1 74.00 0.3\n022345 some estimate row";
    const result = extractDtcs({ text: estimateText, sourceFile: "estimate.pdf", side: "pre" });
    expect(result.dtcs.length).toBe(0);
  });
});

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
