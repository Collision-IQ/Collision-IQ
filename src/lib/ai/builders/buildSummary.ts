import type { AnalysisFinding, AnalysisSummary } from "../types/analysis";

export function buildSummary(findings: AnalysisFinding[]): AnalysisSummary {
  const actionableFindings = findings.filter((finding) => finding.status !== "included");
  const high = actionableFindings.filter((finding) => finding.severity === "high").length;
  const medium = actionableFindings.filter((finding) => finding.severity === "medium").length;
  const low = actionableFindings.filter((finding) => finding.severity === "low").length;
  const riskPoints = high * 3 + medium * 2 + low;
  const findingsWithEvidence = findings.filter((finding) => finding.evidence.length > 0).length;

  return {
    riskScore: riskPoints >= 10 ? "high" : riskPoints >= 5 ? "moderate" : "low",
    confidence:
      findings.length >= 8
        ? "high"
        : findings.length >= 4
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
