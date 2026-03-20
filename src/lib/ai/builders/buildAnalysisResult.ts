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
    mode: "comparison",
    parserStatus: "ok",
    summary,
    findings,
    supplements: findings.filter((finding) => finding.bucket === "supplement"),
    evidence: dedupeEvidence(findings.flatMap((finding) => finding.evidence)),
    narrative,
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
          category: "parser",
          title: "Parser did not produce usable findings",
          detail:
            "The document text was extracted, but the procedural parser did not produce usable findings. No comparison conclusion should be drawn from this run.",
          severity: "high",
          status: "missing",
          evidence: [{ source: "repair-pipeline", quote: `Extracted text length: ${totalTextLength}` }],
        },
      ],
      supplements: [],
      evidence: [{ source: "repair-pipeline", quote: `Extracted text length: ${totalTextLength}` }],
      narrative:
        "## PARSER INCOMPLETE\n\n- The document text was extracted, but the procedural parser did not produce usable findings.\n- No comparison conclusion should be drawn from this run.",
    };
  }

  const summary = buildSummary(dedupedFindings);
  const narrative = buildNarrative({ findings: dedupedFindings, summary });
  const mode = options?.comparisonAvailable ? "comparison" : "single-document-review";
  const adjustedNarrative =
    mode === "single-document-review"
      ? `## SINGLE DOCUMENT REVIEW\n\n- Only one estimate was identified. Comparison findings were not generated.\n\n${narrative}`
      : narrative;

  return {
    mode,
    parserStatus: "ok",
    summary,
    findings: dedupedFindings,
    supplements: dedupedFindings.filter((finding) => finding.bucket === "supplement"),
    evidence: dedupeEvidence(dedupedFindings.flatMap((finding) => finding.evidence)),
    narrative: adjustedNarrative,
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

function inferProcedureFindingsFromOperations(
  pipeline: RepairPipelineResult
): AnalysisFinding[] {
  const definitions: Array<{
    id: string;
    pattern: RegExp;
    bucket: FindingBucket;
    category: string;
    title: string;
  }> = [
    { id: "battery-reset", pattern: /battery isolate|reset electrical components/i, bucket: "quality", category: "electrical", title: "Battery / Electrical Reset" },
    { id: "impact-sensor", pattern: /side impact sensor|impact sensor/i, bucket: "critical", category: "safety", title: "Impact Sensor Service" },
    { id: "pre-scan", pattern: /pre-?repair scan/i, bucket: "adas", category: "diagnostics", title: "Pre-Repair Scan" },
    { id: "in-process-scan", pattern: /in-?proc repair scan|in process repair scan|in-?process scan/i, bucket: "adas", category: "diagnostics", title: "In-Process Repair Scan" },
    { id: "seat-weight", pattern: /seat weight sensor|zero point calibration/i, bucket: "adas", category: "calibration", title: "Seat Weight Sensor Zero Point Calibration" },
    { id: "seat-belt-test", pattern: /seat belt dynamic function test/i, bucket: "critical", category: "safety", title: "Seat Belt Dynamic Function Test" },
    { id: "post-scan", pattern: /post-?repair scan/i, bucket: "adas", category: "diagnostics", title: "Post-Repair Scan" },
    { id: "road-test", pattern: /final road test|safety\s*&?\s*quality check/i, bucket: "quality", category: "qc", title: "Final Road Test" },
    { id: "mask-jambs", pattern: /mask jambs/i, bucket: "quality", category: "refinish", title: "Mask Jambs" },
    { id: "tint-color", pattern: /tint color/i, bucket: "supplement", category: "refinish", title: "Tint Color" },
    { id: "finish-sand-polish", pattern: /finish sand.*polish/i, bucket: "supplement", category: "refinish", title: "Finish Sand and Polish" },
    { id: "cavity-wax", pattern: /cavity wax/i, bucket: "supplement", category: "corrosion", title: "Cavity Wax" },
  ];

  return definitions
    .filter((definition) =>
      pipeline.operations.some((operation) => definition.pattern.test(operation.rawLine))
    )
    .map((definition) => ({
      id: `operation-${definition.id}`,
      bucket: definition.bucket,
      category: definition.category,
      title: definition.title,
      detail: "Procedure was identified directly from the uploaded estimate text.",
      severity:
        definition.bucket === "critical"
          ? "high"
          : definition.bucket === "adas" || definition.bucket === "supplement"
            ? "medium"
            : "low",
      status: "included",
      evidence: [{ source: "Uploaded estimate" }],
    }));
}

function dedupeFindings(findings: AnalysisFinding[]): AnalysisFinding[] {
  const seen = new Map<string, AnalysisFinding>();

  for (const finding of findings) {
    const key = `${finding.bucket}:${finding.title}`.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, finding);
    }
  }

  return [...seen.values()];
}
