import type {
  AnalysisFinding,
  AnalysisResult,
  RepairIntelligenceReport,
} from "../types/analysis";
import {
  extractEstimateFacts,
  resolveCanonicalInsurerCandidate,
} from "../extractors/extractEstimateFacts";
import {
  extractVehicleIdentityFromText,
  mergeVehicleIdentity,
  normalizeVehicleIdentity,
} from "../vehicleContext";

export function normalizeReportToAnalysisResult(
  report: RepairIntelligenceReport
): AnalysisResult {
  const estimateEvidenceText = collectHighSignalVehicleEvidenceText(report);
  const structuredVehicle = mergeVehicleIdentity(
    normalizeVehicleIdentity(report.analysis?.vehicle),
    normalizeVehicleIdentity(report.vehicle)
  );
  const inferredVehicle = extractVehicleIdentityFromText(
    [
      estimateEvidenceText,
      report.vehicle?.vin,
      report.analysis?.vehicle?.vin,
    ]
      .filter(Boolean)
      .join("\n\n"),
    "attachment"
  );
  const guardedInferredVehicle = preserveStructuredDescriptors(structuredVehicle, inferredVehicle);
  const normalizedVehicle = mergeVehicleIdentity(structuredVehicle, guardedInferredVehicle);
  const estimateFacts = mergeEstimateFacts(
    report.estimateFacts,
    report.analysis?.estimateFacts,
    extractEstimateFacts({
      text: estimateEvidenceText,
      vehicle: normalizedVehicle,
    })
  );

  console.info("[vehicle-label-trace:raw-extraction]", {
    reportVehicle: normalizeVehicleIdentity(report.vehicle) ?? null,
    analysisVehicle: normalizeVehicleIdentity(report.analysis?.vehicle) ?? null,
    extractedFromEstimateText: normalizeVehicleIdentity(inferredVehicle) ?? null,
    estimateEvidencePreview: estimateEvidenceText.slice(0, 240) || null,
  });

  console.info("[vehicle-label-trace:normalized-analysis]", {
    structuredVehicle: structuredVehicle ?? null,
    guardedInferredVehicle: guardedInferredVehicle ?? null,
    normalizedVehicle: normalizedVehicle ?? null,
  });

  if (report.analysis) {
    return {
      ...report.analysis,
      vehicle: normalizedVehicle,
      rawEstimateText: report.analysis.rawEstimateText || estimateEvidenceText,
      estimateFacts: {
        ...estimateFacts,
        vehicle: estimateFacts.vehicle ?? normalizedVehicle,
      },
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
    vehicle: normalizedVehicle,
    estimateFacts: {
      ...estimateFacts,
      vehicle: estimateFacts.vehicle ?? normalizedVehicle,
    },
  };
}

function preserveStructuredDescriptors(
  structuredVehicle: ReturnType<typeof normalizeVehicleIdentity>,
  inferredVehicle: ReturnType<typeof normalizeVehicleIdentity> | null
) {
  const normalizedInferred = normalizeVehicleIdentity(inferredVehicle);
  if (!normalizedInferred) {
    return normalizedInferred;
  }

  const structuredHasProtectedVinFields = Boolean(
    structuredVehicle?.vin &&
      (
        structuredVehicle.fieldSources?.vin === "vin_decoded" ||
        structuredVehicle.fieldSources?.year === "vin_decoded" ||
        structuredVehicle.fieldSources?.make === "vin_decoded" ||
        structuredVehicle.fieldSources?.manufacturer === "vin_decoded" ||
        structuredVehicle.source === "vin_decoded"
      )
  );

  const structuredHasValidatedDescriptors = Boolean(
    (structuredVehicle?.model || structuredVehicle?.trim) &&
      (
        structuredHasProtectedVinFields ||
        structuredVehicle?.fieldSources?.model === "attachment" ||
        structuredVehicle?.fieldSources?.model === "user" ||
        structuredVehicle?.fieldSources?.model === "session" ||
        structuredVehicle?.fieldSources?.trim === "attachment" ||
        structuredVehicle?.fieldSources?.trim === "user" ||
        structuredVehicle?.fieldSources?.trim === "session"
      )
  );

  if (!structuredHasProtectedVinFields && !structuredHasValidatedDescriptors) {
    return normalizedInferred;
  }

  // Structured descriptors that are already supported should win; inference only fills gaps.
  return {
    ...normalizedInferred,
    model: structuredVehicle?.model ?? normalizedInferred.model,
    trim: structuredVehicle?.trim ?? normalizedInferred.trim,
  };
}

function collectHighSignalVehicleEvidenceText(report: RepairIntelligenceReport): string {
  return [
    report.sourceEstimateText,
    report.estimateFacts?.documentedProcedures?.join("\n"),
    report.estimateFacts?.documentedHighlights?.join("\n"),
    report.estimateFacts?.vehicle?.vin,
    report.estimateFacts?.insurer,
    extractEstimateEvidenceText(report.evidence),
    report.analysis?.rawEstimateText,
    report.vehicle?.vin,
    report.analysis?.vehicle?.vin,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function mergeEstimateFacts(
  ...candidates: Array<AnalysisResult["estimateFacts"] | undefined>
): NonNullable<AnalysisResult["estimateFacts"]> {
  const normalized = candidates.filter(Boolean);
  if (normalized.length === 0) {
    return {
      documentedProcedures: [],
      documentedHighlights: [],
    };
  }

  return normalized.reduce<NonNullable<AnalysisResult["estimateFacts"]>>(
    (merged, current) => ({
      vehicle: mergeVehicleIdentity(merged.vehicle, current?.vehicle),
      mileage: merged.mileage ?? current?.mileage,
      insurer: resolveCanonicalInsurerCandidate(
        { value: merged.insurer, source: "prior" },
        { value: current?.insurer, source: "prior" }
      ),
      estimateTotal: merged.estimateTotal ?? current?.estimateTotal,
      documentedProcedures: [
        ...new Set([...(merged.documentedProcedures ?? []), ...(current?.documentedProcedures ?? [])]),
      ],
      documentedHighlights: [
        ...new Set([...(merged.documentedHighlights ?? []), ...(current?.documentedHighlights ?? [])]),
      ],
    }),
    {
      documentedProcedures: [] as string[],
      documentedHighlights: [] as string[],
    }
  );
}

function extractEstimateEvidenceText(evidence: RepairIntelligenceReport["evidence"]): string {
  return evidence
    .filter((entry) => entry.authority !== "oem")
    .filter((entry) => !/^(OEM Procedures|OEM Position Statements|PA Law)\s*\//i.test(entry.source))
    .map((entry) => `${entry.title ?? ""}\n${entry.snippet ?? ""}`)
    .join("\n");
}
