import type { RepairPipelineResult } from "../pipeline/repairPipeline";
import type {
  AnalysisFinding,
  AnalysisResult,
  AuditFinding,
  FindingBucket,
  RepairAuditReport,
} from "../types/analysis";
import { buildNarrative } from "./buildNarrative";
import { buildSummary } from "./buildSummary";

export function buildAnalysisResultFromAuditReport(
  report: RepairAuditReport
): AnalysisResult {
  const findings = report.findings.map(mapAuditFinding);
  const summary = buildSummary(findings);
  const narrative = buildNarrative({ findings, summary });

  return {
    summary,
    findings,
    supplements: findings.filter((finding) => finding.bucket === "supplement"),
    evidence: dedupeEvidence(findings.flatMap((finding) => finding.evidence)),
    narrative,
  };
}

export function buildAnalysisResultFromPipeline(
  pipeline: RepairPipelineResult
): AnalysisResult {
  const findings: AnalysisFinding[] = [
    ...pipeline.complianceIssues.map((issue, index) => {
      const status: AnalysisFinding["status"] =
        issue.category === "supplement_opportunity" ? "reduced" : "missing";

      return {
        id: `pipeline-issue-${index + 1}`,
        bucket: mapComplianceBucket(issue.category),
        category: issue.category,
        title: issue.issue,
        detail: issue.reference,
        severity: issue.severity,
        status,
        evidence: [{ source: issue.evidenceBasis }],
      };
    }),
    ...pipeline.adasFindings.map((finding, index) => ({
      id: `pipeline-adas-${index + 1}`,
      bucket: "adas" as const,
      category: finding.category,
      title: finding.finding,
      detail: finding.evidence,
      severity: "low" as const,
      status: "included" as const,
      evidence: [{ source: finding.evidence }],
    })),
  ];

  const summary = buildSummary(findings);
  const narrative = buildNarrative({ findings, summary });

  return {
    summary,
    findings,
    supplements: findings.filter((finding) => finding.bucket === "supplement"),
    evidence: dedupeEvidence(findings.flatMap((finding) => finding.evidence)),
    narrative,
  };
}

function mapAuditFinding(finding: AuditFinding): AnalysisFinding {
  return {
    id: finding.id,
    bucket: mapAuditBucket(finding),
    category: finding.category,
    title: finding.title,
    detail: finding.conclusion,
    severity: finding.severity,
    status:
      finding.category === "parts"
        ? "exposure"
        : finding.status === "included"
          ? "included"
          : finding.category === "refinish" || finding.category === "corrosion"
            ? "reduced"
            : "missing",
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
  category: RepairPipelineResult["complianceIssues"][number]["category"]
): FindingBucket {
  if (category === "calibration_requirement" || category === "safety_risk") {
    return "critical";
  }
  if (category === "supplement_opportunity") return "supplement";
  if (category === "compliance_issue") return "compliance";
  return "quality";
}

function dedupeEvidence(evidence: AnalysisResult["evidence"]): AnalysisResult["evidence"] {
  const seen = new Set<string>();

  return evidence.filter((entry) => {
    const key = `${entry.source}:${entry.page ?? ""}:${entry.quote ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
