import type { RepairPipelineResult } from "../pipeline/repairPipeline";
import type { ComplianceIssue } from "../validators/complianceValidator";
import type {
  AnalysisFinding,
  AnalysisResult,
  AuditFinding,
  FindingBucket,
  RepairAuditReport,
} from "../types/analysis";
import { buildSummary } from "./buildSummary";

export function buildAnalysisResultFromAuditReport(
  report: RepairAuditReport
): AnalysisResult {
  const findings = report.findings.map(mapAuditFinding);
  const summary = buildSummary(findings);

  const result: AnalysisResult = {
    mode: "comparison",
    parserStatus: "ok",
    summary,
    findings,
    supplements: findings.filter((finding) => finding.bucket === "supplement"),
    evidence: dedupeEvidence(findings.flatMap((finding) => finding.evidence)),
    operations: [],
    rawEstimateText: "",
    narrative: "",
  };

  return {
    ...result,
    narrative: "",
  };
}

export function buildAnalysisResultFromPipeline(
  pipeline: RepairPipelineResult,
  options?: {
    comparisonAvailable?: boolean;
    totalTextLength?: number;
  }
): AnalysisResult {
  const findings: AnalysisFinding[] = [
    ...pipeline.observations.map((observation, index) =>
      buildObservationFinding(observation, index)
    ),
    ...pipeline.adasFindings.map((finding, index) => ({
      id: `pipeline-adas-${index + 1}`,
      bucket: "adas" as const,
      category: "included",
      title: finding.finding,
      detail: "This function is referenced in supporting ADAS documentation.",
      severity: "low" as const,
      status: "present" as const,
      evidence: [{ source: finding.evidence }],
    })),
    ...inferProcedureFindingsFromOperations(pipeline),
  ];

  const dedupedFindings = dedupeFindings(findings);
  const totalTextLength = options?.totalTextLength ?? 0;

  if (dedupedFindings.length === 0 && totalTextLength > 3000) {
    return {
      mode: "parser-incomplete",
      parserStatus: "failed_or_incomplete",
      summary: {
        riskScore: "unknown",
        confidence: "low",
        criticalIssues: 0,
        evidenceQuality: "weak",
      },
      findings: [
        {
          id: "parser-incomplete",
          bucket: "compliance",
          category: "not_detected",
          title: "Parser did not produce usable findings",
          detail:
            "The document text was extracted, but the procedural parser did not produce usable findings. No comparison conclusion should be drawn from this run.",
          severity: "high",
          status: "not_detected",
          evidence: [
            {
              source: "repair-pipeline",
              quote: `Extracted text length: ${totalTextLength}`,
            },
          ],
        },
      ],
      supplements: [],
      evidence: [
        {
          source: "repair-pipeline",
          quote: `Extracted text length: ${totalTextLength}`,
        },
      ],
      operations: pipeline.operations,
      rawEstimateText: pipeline.documents.map((document) => document.text ?? "").join("\n\n"),
      narrative:
        "The document text was extracted, but the procedural parser did not produce usable findings. No comparison conclusion should be drawn from this run.",
    };
  }

  const summary = buildSummary(dedupedFindings);

  const result: AnalysisResult = {
    mode: options?.comparisonAvailable ? "comparison" : "single-document-review",
    parserStatus: "ok",
    summary,
    findings: dedupedFindings,
    supplements: dedupedFindings.filter((finding) => finding.bucket === "supplement"),
    evidence: dedupeEvidence(dedupedFindings.flatMap((finding) => finding.evidence)),
    operations: pipeline.operations,
    rawEstimateText: pipeline.documents.map((document) => document.text ?? "").join("\n\n"),
    narrative: "",
  };

  return {
    ...result,
    narrative: "",
  };
}

function mapAuditFinding(finding: AuditFinding): AnalysisFinding {
  const status: AnalysisFinding["status"] =
    finding.category === "parts"
      ? "exposure"
      : finding.status === "included"
        ? "present"
        : finding.category === "refinish" || finding.category === "corrosion"
          ? "unclear"
          : "not_detected";

  return {
    id: finding.id,
    bucket: mapAuditBucket(finding),
    category: mapCategoryFromStatus(status),
    title: finding.title,
    detail: finding.conclusion,
    severity: finding.severity,
    status,
    evidence: finding.evidence,
  };
}

function mapAuditBucket(finding: AuditFinding): FindingBucket {
  if (finding.category === "parts") return "parts";
  if (finding.category === "calibration" || finding.category === "scan") {
    return finding.severity === "high" ? "critical" : "adas";
  }
  if (finding.category === "qc") {
    return finding.severity === "high" ? "critical" : "quality";
  }
  if (finding.category === "corrosion" || finding.category === "refinish") {
    return "supplement";
  }
  return "compliance";
}

function mapComplianceBucket(
  category: ComplianceIssue["category"]
): FindingBucket {
  if (category === "calibration_requirement" || category === "safety_risk") {
    return "critical";
  }
  if (category === "supplement_opportunity") return "supplement";
  if (category === "compliance_issue") return "compliance";
  return "quality";
}

function dedupeEvidence(
  evidence: AnalysisResult["evidence"]
): AnalysisResult["evidence"] {
  const seen = new Set<string>();

  return evidence.filter((entry) => {
    const key = `${entry.source}:${entry.page ?? ""}:${entry.quote ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function inferProcedureFindingsFromOperations(
  pipeline: RepairPipelineResult
): AnalysisFinding[] {
  const definitions: Array<{
    id: string;
    pattern: RegExp;
    bucket: FindingBucket;
    title: string;
  }> = [
    { id: "battery-reset", pattern: /battery isolate|reset electrical components/i, bucket: "quality", title: "Battery / Electrical Reset" },
    { id: "impact-sensor", pattern: /side impact sensor|impact sensor/i, bucket: "critical", title: "Impact Sensor Service" },
    { id: "pre-scan", pattern: /pre-?repair scan/i, bucket: "adas", title: "Pre-Repair Scan" },
    { id: "in-process-scan", pattern: /in-?proc repair scan|in process repair scan|in-?process scan/i, bucket: "adas", title: "In-Process Repair Scan" },
    { id: "seat-weight", pattern: /seat weight sensor|zero point calibration/i, bucket: "adas", title: "Seat Weight Sensor Zero Point Calibration" },
    { id: "seat-belt-test", pattern: /seat belt dynamic function test/i, bucket: "critical", title: "Seat Belt Dynamic Function Test" },
    { id: "post-scan", pattern: /post-?repair scan/i, bucket: "adas", title: "Post-Repair Scan" },
    { id: "road-test", pattern: /final road test|safety\\s*&?\\s*quality check/i, bucket: "quality", title: "Final Road Test" },
    { id: "mask-jambs", pattern: /mask jambs/i, bucket: "quality", title: "Mask Jambs" },
    { id: "tint-color", pattern: /tint color/i, bucket: "supplement", title: "Tint Color" },
    { id: "finish-sand-polish", pattern: /finish sand.*polish/i, bucket: "supplement", title: "Finish Sand and Polish" },
    { id: "cavity-wax", pattern: /cavity wax/i, bucket: "supplement", title: "Cavity Wax" },
  ];

  return definitions
    .filter((definition) =>
      pipeline.operations.some((operation) => definition.pattern.test(operation.rawLine))
    )
    .map((definition) => ({
      id: `operation-${definition.id}`,
      bucket: definition.bucket,
      category: "included",
      title: definition.title,
      detail:
        "This operation appears directly in the extracted estimate text. It supports the overall picture, but does not by itself confirm complete functional coverage.",
      severity:
        definition.bucket === "critical"
          ? "high"
          : definition.bucket === "adas" || definition.bucket === "supplement"
            ? "medium"
            : "low",
      status: "present" as const,
      evidence: [{ source: "Uploaded estimate" }],
    }));
}

function buildObservationFinding(
  observation: ComplianceIssue,
  index: number
): AnalysisFinding {
  const status = mapObservationStatus(observation);
  const category = mapCategoryFromStatus(status);

  return {
    id: `pipeline-observation-${index + 1}`,
    bucket: mapComplianceBucket(observation.category),
    category,
    title: observation.procedure ?? observation.issue,
    detail: buildObservationDescription(observation),
    severity:
      status === "not_detected"
        ? "high"
        : status === "unclear"
          ? "medium"
          : "low",
    status,
    evidence: buildObservationEvidence(observation),
  };
}

function buildObservationDescription(observation: ComplianceIssue): string {
  const parts = [
    observation.observation ?? observation.issue,
    observation.basis,
    observation.impact,
  ].filter(Boolean);

  return parts.join(". ");
}

function buildObservationEvidence(
  observation: ComplianceIssue
): AnalysisFinding["evidence"] {
  return [
    { source: observation.evidenceBasis },
    ...(observation.reference
      ? [{ source: "repair-pipeline", quote: observation.reference }]
      : []),
  ];
}

function mapObservationStatus(
  observation: ComplianceIssue
): AnalysisFinding["status"] {
  return observation.status ?? "unclear";
}

function mapCategoryFromStatus(
  status: AnalysisFinding["status"]
): AnalysisFinding["category"] {
  if (status === "present") return "included";
  if (status === "unclear") return "unclear";
  if (status === "not_detected") return "not_detected";
  return "exposure";
}

function dedupeFindings(findings: AnalysisFinding[]): AnalysisFinding[] {
  const seen = new Map<string, AnalysisFinding>();

  for (const finding of findings) {
    const key = `${finding.bucket}:${finding.title}:${finding.category}`.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, finding);
    }
  }

  return [...seen.values()];
}
