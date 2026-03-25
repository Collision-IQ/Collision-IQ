import type {
  AnalysisFinding,
  AnalysisResult,
  RepairIntelligenceReport,
} from "../types/analysis";
import {
  extractVehicleIdentityFromText,
  mergeVehicleIdentity,
  normalizeVehicleIdentity,
} from "../vehicleContext";

export function normalizeReportToAnalysisResult(
  report: RepairIntelligenceReport
): AnalysisResult {
  const inferredVehicle = extractVehicleIdentityFromText(
    [
      report.evidence.map((entry) => `${entry.title ?? ""}\n${entry.snippet ?? ""}`).join("\n"),
      report.recommendedActions.join("\n"),
      report.vehicle?.vin,
      report.analysis?.vehicle?.vin,
    ]
      .filter(Boolean)
      .join("\n\n"),
    "attachment"
  );

  if (report.analysis) {
    return {
      ...report.analysis,
      vehicle: mergeVehicleIdentity(report.analysis.vehicle, report.vehicle, inferredVehicle),
    };
  }

  const findings: AnalysisFinding[] = [
    ...report.issues.map((issue, index) => {
      const bucket: AnalysisFinding["bucket"] =
        issue.category === "parts"
          ? "parts"
          : issue.category === "calibration" || issue.category === "scan"
            ? "adas"
            : issue.category === "safety"
              ? "critical"
              : "compliance";
      const status: AnalysisFinding["status"] = issue.missingOperation
        ? "not_detected"
        : "unclear";

      return {
        id: issue.id || `report-issue-${index + 1}`,
        bucket,
        category: issue.category,
        title: issue.title,
        detail: issue.impact || issue.finding,
        severity: issue.severity,
        status,
        evidence: [],
      };
    }),
    ...report.missingProcedures.map((procedure, index) => ({
      id: `report-missing-${index + 1}`,
      bucket: "supplement" as const,
      category: "missing_procedure",
      title: procedure,
      detail: "This function is not clearly represented in the current estimate.",
      severity: "medium" as const,
      status: "not_detected" as const,
      evidence: [],
    })),
  ];

  return {
    mode: "single-document-review",
    parserStatus: "ok",
    summary: {
      riskScore: report.summary.riskScore,
      confidence: report.summary.confidence,
      criticalIssues: report.summary.criticalIssues,
      evidenceQuality: report.summary.evidenceQuality,
    },
    findings,
    supplements: findings.filter((finding) => finding.bucket === "supplement"),
    evidence: report.evidence.map((entry) => ({
      source: entry.source,
      quote: entry.snippet,
    })),
    operations: [],
    rawEstimateText: report.evidence.map((entry) => entry.snippet).join("\n"),
    narrative:
      report.recommendedActions[0] ||
      "The estimate needs clearer repair support before it can be treated as fully defended.",
    vehicle: mergeVehicleIdentity(normalizeVehicleIdentity(report.vehicle), inferredVehicle),
  };
}
