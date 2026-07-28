// Scan IQ report builder — customer-facing plain English (summary first),
// Pro/Admin technical table, and a report object compatible with the existing
// report history (RepairIntelligenceReport JSON shape).

import type { RepairIntelligenceReport } from "@/lib/ai/types/analysis";
import type { ScanIqComparison } from "@/lib/scans/scanTypes";

export type ScanIqReportText = {
  /** Layman-first: answer, then why it matters, then supporting detail. */
  customerSummary: string;
  /** Markdown technical table for Pro/Admin views. */
  technicalTable: string;
  /** One-line MOTOR source status. */
  motorStatusLine: string;
};

export function buildScanIqReportText(comparison: ScanIqComparison): ScanIqReportText {
  const { summary, rows } = comparison;
  const unresolved = summary.remainingCount + summary.newCount;

  // Stored-memory codes are reported separately: they are fault-memory
  // content, not unresolved repair problems, and folding them into
  // "unresolved" would misstate a routine full-memory printout as ~100 open
  // post-repair faults.
  const storedNote =
    summary.storedOnPostCount > 0
      ? ` ${summary.storedOnPostCount} additional stored/history code${summary.storedOnPostCount === 1 ? "" : "s"} appear only in the post-scan fault memory — likely pre-existing memory content; clear and re-scan to confirm.`
      : "";
  const answer =
    unresolved > 0
      ? `Summary: The post-scan still shows ${unresolved} unresolved diagnostic code${unresolved === 1 ? "" : "s"} after repairs (${summary.remainingCount} remaining, ${summary.newCount} new).${storedNote}`
      : summary.clearedCount > 0
        ? `Summary: All ${summary.clearedCount} diagnostic code${summary.clearedCount === 1 ? "" : "s"} from the pre-scan were cleared by the post-scan.${storedNote}`
        : summary.storedOnPostCount > 0
          ? `Summary: No active or unresolved diagnostic codes were identified.${storedNote}`
          : "Summary: No diagnostic trouble codes were identified on either scan.";

  const why =
    unresolved > 0
      ? "Why it matters: Remaining or new codes may indicate additional diagnosis, calibration, documentation, or repair verification is needed before the file is complete."
      : "Why it matters: A clean post-scan supports that the repair addressed the systems flagged before repairs, subject to required calibrations and documentation.";

  const moduleGaps: string[] = [];
  if (comparison.summary.modulesOnlyInPre.length > 0) {
    moduleGaps.push(
      `Modules seen on the pre-scan but not the post-scan: ${comparison.summary.modulesOnlyInPre.join(", ")}.`
    );
  }
  if (comparison.summary.modulesOnlyInPost.length > 0) {
    moduleGaps.push(
      `Modules seen on the post-scan but not the pre-scan: ${comparison.summary.modulesOnlyInPost.join(", ")}.`
    );
  }

  const customerSummary = [answer, "", why, ...(moduleGaps.length ? ["", ...moduleGaps] : [])].join("\n");

  const header = "| DTC | Module | Pre | Post | Change | Description | MOTOR |";
  const divider = "| --- | --- | --- | --- | --- | --- | --- |";
  const tableRows = rows.map((row) =>
    [
      row.code,
      row.module ?? "—",
      row.preStatus ?? "—",
      row.postStatus ?? "—",
      row.changeType === "stored_on_post" ? "stored (memory)" : row.changeType,
      (row.normalizedDescription ?? row.originalDescription ?? "—").replace(/\|/g, "/"),
      row.motorLookupStatus,
    ]
      .map((cell) => `| ${cell} `)
      .join("") + "|"
  );
  const technicalTable = [header, divider, ...tableRows].join("\n");

  const motorModes = new Set(rows.map((row) => row.motorLookupStatus));
  const motorStatusLine = motorModes.has("vehicle-specific-sandbox")
    ? "MOTOR: vehicle-specific sandbox evidence was retrieved for this vehicle (limited 15-vehicle sandbox coverage)."
    : motorModes.has("general-reference")
      ? "MOTOR: general DTC reference was used to classify codes (not vehicle-specific evidence)."
      : motorModes.has("error") || motorModes.has("unavailable") || motorModes.has("not-configured")
        ? "MOTOR: lookup was attempted but unavailable — scan comparison is unaffected."
        : "MOTOR: not used for this comparison.";

  return { customerSummary, technicalTable, motorStatusLine };
}

/**
 * Build a report object that saves cleanly into the existing report history
 * (AnalysisReport JSON) without touching report-generation code paths.
 */
export function buildScanIqHistoryReport(
  comparison: ScanIqComparison,
  text: ScanIqReportText
): RepairIntelligenceReport {
  const { summary } = comparison;
  const unresolved = summary.remainingCount + summary.newCount;
  // Risk keys on genuinely-new (active) and remaining faults; stored fault
  // memory alone never drives the score above "low".
  const riskScore = summary.newCount > 0 ? "high" : summary.remainingCount > 0 ? "moderate" : "low";
  const vehicle = comparison.post.vin || comparison.pre.vin
    ? {
        vin: comparison.post.vin ?? comparison.pre.vin ?? undefined,
        year: comparison.post.year ?? comparison.pre.year ?? undefined,
        make: comparison.post.make ?? comparison.pre.make ?? undefined,
        model: comparison.post.model ?? comparison.pre.model ?? undefined,
      }
    : {
        year: comparison.post.year ?? comparison.pre.year ?? undefined,
        make: comparison.post.make ?? comparison.pre.make ?? undefined,
        model: comparison.post.model ?? comparison.pre.model ?? undefined,
      };

  return {
    summary: {
      riskScore,
      confidence: comparison.pre.unreadable || comparison.post.unreadable ? "low" : "moderate",
      criticalIssues: unresolved,
      evidenceQuality: comparison.pre.unreadable || comparison.post.unreadable ? "weak" : "moderate",
    },
    vehicle: vehicle as RepairIntelligenceReport["vehicle"],
    issues: [],
    requiredProcedures: [],
    presentProcedures: [],
    missingProcedures: [],
    supplementOpportunities: [],
    evidence: [],
    recommendedActions:
      unresolved > 0
        ? [
            "Review remaining/new DTCs with the repair facility before closing the file.",
            "Confirm required calibrations and scan documentation are complete.",
          ]
        : ["Retain pre/post scan reports as repair documentation."],
    sourceEstimateText: [
      "SCAN IQ — PRE/POST SCAN COMPARISON",
      "",
      text.customerSummary,
      "",
      text.technicalTable,
      "",
      text.motorStatusLine,
      "",
      `Pre-scan file: ${comparison.pre.sourceFile}${comparison.pre.scanDate ? ` (${comparison.pre.scanDate})` : ""}`,
      `Post-scan file: ${comparison.post.sourceFile}${comparison.post.scanDate ? ` (${comparison.post.scanDate})` : ""}`,
      comparison.pre.scannerVendor || comparison.post.scannerVendor
        ? `Scanner: ${comparison.post.scannerVendor ?? comparison.pre.scannerVendor}`
        : "",
    ]
      .filter((line) => line !== "")
      .join("\n"),
    ingestionMeta: {
      active: true,
      reportKind: "scan_iq",
    } as RepairIntelligenceReport["ingestionMeta"],
  };
}
