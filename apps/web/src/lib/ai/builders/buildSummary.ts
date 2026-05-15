import type { AnalysisFinding, AnalysisSummary } from "../types/analysis";

export function buildSummary(findings: AnalysisFinding[]): AnalysisSummary {
  const actionableFindings = findings.filter((finding) => finding.status !== "present");
  const weightedFindings = actionableFindings.map((finding) => {
    const severityWeight =
      finding.severity === "high" ? 3 : finding.severity === "medium" ? 2 : 1;
    const clarityWeight =
      finding.status === "not_detected"
        ? 1.25
        : finding.status === "exposure"
          ? 1.1
          : 0.75;

    return severityWeight * clarityWeight;
  });
  const riskPoints = weightedFindings.reduce((sum, score) => sum + score, 0);
  const findingsWithEvidence = findings.filter((finding) => finding.evidence.length > 0).length;

  return {
    riskScore: riskPoints >= 10 ? "high" : riskPoints >= 5 ? "moderate" : "low",
    confidence:
      findingsWithEvidence >= 8
        ? "high"
        : findingsWithEvidence >= 4
          ? "moderate"
          : "low",
    criticalIssues: actionableFindings.filter((finding) => finding.bucket === "critical")
      .length,
    evidenceQuality:
      findingsWithEvidence >= 6
        ? "strong"
        : findingsWithEvidence >= 1
          ? "moderate"
          : "weak",
  };
}
