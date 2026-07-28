import { describe, expect, it } from "vitest";
import { parseScanReport } from "@/lib/scans/scanParser";
import { compareScans } from "@/lib/scans/scanComparator";
import { buildScanIqReportText, buildScanIqHistoryReport } from "@/lib/scans/scanReportBuilder";

const PRE = `
Pre-Repair Scan 2010 Honda Civic VIN 19XFA1F51AE028415
ECM - Engine Control Module
P0301 Cylinder 1 Misfire Detected ACTIVE
P0420 Catalyst Efficiency STORED
SRS - Airbag Module
B0001 Driver Frontal Deployment ACTIVE
`;

const POST = `
Post-Repair Scan 2010 Honda Civic VIN 19XFA1F51AE028415
ECM - Engine Control Module
P0420 Catalyst Efficiency STORED
ABS - Anti-lock Brake Module
C0040 Right Front Wheel Speed Sensor ACTIVE
`;

function makeComparison() {
  const pre = parseScanReport({ text: PRE, sourceFile: "pre.pdf", side: "pre" });
  const post = parseScanReport({ text: POST, sourceFile: "post.pdf", side: "post" });
  return compareScans(pre, post);
}

describe("scanComparator", () => {
  const comparison = makeComparison();
  const byCode = new Map(comparison.rows.map((row) => [row.code.slice(0, 5), row]));

  it("identifies cleared, remaining, and new codes", () => {
    expect(byCode.get("P0301")?.changeType).toBe("cleared");
    expect(byCode.get("B0001")?.changeType).toBe("cleared");
    expect(byCode.get("P0420")?.changeType).toBe("remaining");
    expect(byCode.get("C0040")?.changeType).toBe("new");
    expect(comparison.summary.clearedCount).toBe(2);
    expect(comparison.summary.remainingCount).toBe(1);
    expect(comparison.summary.newCount).toBe(1);
  });

  it("tracks modules not scanned on one side", () => {
    expect(comparison.summary.modulesOnlyInPre.some((m) => /SRS/i.test(m))).toBe(true);
    expect(comparison.summary.modulesOnlyInPost.some((m) => /ABS/i.test(m))).toBe(true);
  });

  it("keeps evidence file references per side", () => {
    const remaining = byCode.get("P0420")!;
    expect(remaining.evidence.preSourceFile).toBe("pre.pdf");
    expect(remaining.evidence.postSourceFile).toBe("post.pdf");
  });

  it("unreadable side yields unknown change types instead of false claims", () => {
    const pre = parseScanReport({ text: PRE, sourceFile: "pre.pdf", side: "pre" });
    const post = parseScanReport({ text: "", sourceFile: "broken.pdf", side: "post" });
    const busted = compareScans(pre, post);
    expect(busted.rows.every((row) => row.changeType === "unknown")).toBe(true);
  });
});

describe("scanComparator stored-memory weighting (RO 22009)", () => {
  // An ISTA "Fault code memory list" post-scan carries dozens of STORED codes
  // with no pre-scan counterpart. Those are fault-memory content, not
  // repair-induced faults — they must never flood "new" or force high risk.
  const PRE_BMW = `
Pre-Repair Scan 2022 BMW X5
Front Radar Sensor Long Range:
0x482136 - ACC sensor/FRSF: Maladjustment - Not present
`;
  const POST_BMW = `
Fault code memory list VIN: 5UXTA6C04N9M51734
022345 SAS: Voltage supply - global external undervoltage 83219 No Information
0300B1 Power window regulator, passenger's side: Hardware fault 83219 No Battery
0316D1 High-voltage battery unit: Category 1 fault 83219 yes Information
482136 ACC sensor/FRSF: Maladjustment 83219 No Information
`;

  const pre = parseScanReport({ text: PRE_BMW, sourceFile: "astech-pre.pdf", side: "pre" });
  const post = parseScanReport({ text: POST_BMW, sourceFile: "ista-post.pdf", side: "post" });
  const comparison = compareScans(pre, post);
  const byCode = new Map(comparison.rows.map((row) => [row.code.replace(/^0x/i, "").slice(0, 6), row]));

  it("post-only stored/history codes classify as stored_on_post, not new", () => {
    expect(byCode.get("022345")?.changeType).toBe("stored_on_post");
    expect(byCode.get("0300B1")?.changeType).toBe("stored_on_post");
    expect(comparison.summary.storedOnPostCount).toBe(2);
  });

  it("the same code pairs across vendors even when one side lacks module headings", () => {
    // asTech pre carries "Front Radar Sensor Long Range"; the ISTA list has
    // no module headings — code-only fallback must still pair 482136.
    expect(byCode.get("482136")?.changeType).toBe("remaining");
    expect(comparison.summary.clearedCount).toBe(0);
  });

  it("post-only currently-present codes (ISTA yes column) stay new", () => {
    expect(byCode.get("0316D1")?.changeType).toBe("new");
    expect(comparison.summary.newCount).toBe(1);
  });

  it("stored-memory rows never claim the code appeared after repair", () => {
    expect(byCode.get("022345")?.repairRelevance).toMatch(/pre-existing memory/i);
    expect(byCode.get("022345")?.repairRelevance).not.toMatch(/appeared after repair/i);
  });

  it("report summary separates stored-memory codes and keeps them out of unresolved", () => {
    const text = buildScanIqReportText(comparison);
    expect(text.customerSummary).toMatch(/stored\/history code/i);
    expect(text.customerSummary).not.toMatch(/3 unresolved/);
    expect(text.technicalTable).toContain("stored (memory)");
  });

  it("stored memory alone never drives risk above low", () => {
    const storedOnly = compareScans(
      parseScanReport({ text: "Pre-Repair Scan 2022 BMW X5", sourceFile: "pre.pdf", side: "pre" }),
      parseScanReport({
        text: "Fault code memory list VIN X\n022345 SAS: Voltage supply 83219 No Information",
        sourceFile: "post.pdf",
        side: "post",
      })
    );
    const report = buildScanIqHistoryReport(storedOnly, buildScanIqReportText(storedOnly));
    expect(report.summary.riskScore).toBe("low");
  });
});

describe("scanReportBuilder", () => {
  const comparison = makeComparison();
  const text = buildScanIqReportText(comparison);

  it("customer summary is plain English and summary-first", () => {
    expect(text.customerSummary.startsWith("Summary:")).toBe(true);
    expect(text.customerSummary).toContain("unresolved diagnostic code");
    expect(text.customerSummary).toContain("Why it matters:");
    // Layman-first: no technical table markup in the customer summary.
    expect(text.customerSummary).not.toContain("|");
  });

  it("technical table includes DTC, module, pre/post, change type, and MOTOR status", () => {
    expect(text.technicalTable).toContain("| DTC | Module | Pre | Post | Change |");
    expect(text.technicalTable).toContain("P0420");
    expect(text.technicalTable).toContain("remaining");
    expect(text.technicalTable).toContain("new");
  });

  it("history report saves with vehicle + risk derived from unresolved codes", () => {
    const report = buildScanIqHistoryReport(comparison, text);
    expect(report.summary.riskScore).toBe("high"); // new code present
    expect(report.vehicle?.vin).toBe("19XFA1F51AE028415");
    expect(report.sourceEstimateText).toContain("SCAN IQ");
    expect(report.recommendedActions.length).toBeGreaterThan(0);
  });
});
