import type {
  AnalysisFinding,
  AnalysisResult,
  RepairIntelligenceReport,
} from "../types/analysis";
import {
  extractVehicleIdentityFromText,
  normalizeVehicleIdentity,
  resolveVehicleIdentity,
} from "../vehicleContext";

const DEBUG_VEHICLE_IDENTITY = process.env.DEBUG_VEHICLE_IDENTITY === "1";

function logVehicleCheckpoint(reportVehicle: AnalysisResult["vehicle"]) {
  if (!DEBUG_VEHICLE_IDENTITY) {
    return;
  }

  console.info("[vehicle-checkpoint:normalized analysis.vehicle]", {
    vin: reportVehicle?.vin ?? null,
    year: reportVehicle?.year ?? null,
    make: reportVehicle?.make ?? null,
    model: reportVehicle?.model ?? null,
    trim: reportVehicle?.trim ?? null,
    confidence: reportVehicle?.confidence ?? null,
    source: reportVehicle?.source ?? null,
    fieldSources: reportVehicle?.fieldSources ?? null,
  });
}

export function normalizeReportToAnalysisResult(
  report: RepairIntelligenceReport
): AnalysisResult {
  const estimateEvidenceText = extractEstimateEvidenceText(report.evidence);
  const reportAnalysisVehicle = normalizeVehicleIdentity(report.analysis?.vehicle);
  const reportVehicle = normalizeVehicleIdentity(report.vehicle);
  const inferredVehicle = extractVehicleIdentityFromText(
    [
      estimateEvidenceText,
      report.recommendedActions.join("\n"),
      reportVehicle?.vin,
      reportAnalysisVehicle?.vin,
    ]
      .filter(Boolean)
      .join("\n\n"),
    "attachment"
  );
  const resolvedVehicle = resolveVehicleIdentity(
    reportAnalysisVehicle,
    reportVehicle,
    inferredVehicle
  ).identity;
  const preservedStructuredVin =
    reportAnalysisVehicle?.vin ||
    reportVehicle?.vin ||
    resolvedVehicle?.vin ||
    undefined;
  const finalVehicle = {
    ...resolvedVehicle,
    vin: preservedStructuredVin,
  };
  logVehicleCheckpoint(finalVehicle);

  if (report.analysis) {
    return {
      ...report.analysis,
      vehicle: finalVehicle,
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
    rawEstimateText: estimateEvidenceText,
    narrative:
      report.recommendedActions[0] ||
      "The estimate needs clearer repair support before it can be treated as fully defended.",
    vehicle: finalVehicle,
  };
}

function extractEstimateEvidenceText(evidence: RepairIntelligenceReport["evidence"]): string {
  return evidence
    .filter((entry) => entry.authority !== "oem")
    .filter((entry) => !/^(OEM Procedures|OEM Position Statements|PA Law)\s*\//i.test(entry.source))
    .map((entry) => `${entry.title ?? ""}\n${entry.snippet ?? ""}`)
    .join("\n");
}
