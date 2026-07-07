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
