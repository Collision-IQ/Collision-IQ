import type { AnalysisResult } from "../types/analysis";

export interface InspectorPanelData {
  riskScore: "low" | "medium" | "high";
  confidence: "low" | "medium" | "high";
  criticalIssues: number;
  evidenceQuality: "present" | "limited" | "none";
  keyRisks: string[];
  complianceIssues: string[];
  supplementOpportunities: string[];
  evidenceReferences: string[];
}

export function buildRepairIntelligenceReport(result: AnalysisResult): string {
  if (result.findings.length === 0) {
    return "";
  }

  const findingLines = result.findings
    .slice(0, 12)
    .map(
      (finding) =>
        `- [${finding.bucket}] ${finding.title} | Status: ${finding.status} | Severity: ${finding.severity}`
    )
    .join("\n");

  const evidenceLines = result.evidence.length
    ? result.evidence
        .slice(0, 8)
        .map(
          (entry) =>
            `- ${entry.source}${entry.page ? `, page ${entry.page}` : ""}${entry.quote ? ` | ${entry.quote}` : ""}`
        )
        .join("\n")
    : "- No evidence references extracted";

  return `
[ANALYSIS RESULT]

Risk Score: ${result.summary.riskScore.toUpperCase()}
Confidence: ${result.summary.confidence.toUpperCase()}
Critical Issues: ${result.summary.criticalIssues}
Evidence Quality: ${result.summary.evidenceQuality.toUpperCase()}

Findings:
${findingLines}

Evidence:
${evidenceLines}
`.trim();
}

export function buildInspectorPanelData(result: AnalysisResult): InspectorPanelData {
  return {
    riskScore:
      result.summary.riskScore === "moderate" ? "medium" : result.summary.riskScore,
    confidence:
      result.summary.confidence === "moderate"
        ? "medium"
        : result.summary.confidence,
    criticalIssues: result.summary.criticalIssues,
    evidenceQuality:
      result.summary.evidenceQuality === "strong"
        ? "present"
        : result.summary.evidenceQuality === "moderate"
          ? "limited"
          : "none",
    keyRisks: result.findings
      .filter((finding) => finding.bucket === "critical")
      .slice(0, 4)
      .map((finding) => finding.title),
    complianceIssues: result.findings
      .filter((finding) => finding.bucket === "compliance" || finding.bucket === "quality")
      .slice(0, 4)
      .map((finding) => finding.title),
    supplementOpportunities: result.findings
      .filter((finding) => finding.bucket === "supplement")
      .slice(0, 4)
      .map((finding) => finding.title),
    evidenceReferences: result.evidence
      .slice(0, 4)
      .map(
        (entry) =>
          `${entry.source}${entry.page ? `, page ${entry.page}` : ""}${entry.quote ? ` | ${entry.quote}` : ""}`
      ),
  };
}
