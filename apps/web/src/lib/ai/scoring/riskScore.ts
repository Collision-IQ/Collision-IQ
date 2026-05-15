export function computeRiskScore(params: {
  highSeverityIssues: number;
  mediumSeverityIssues: number;
  lowSeverityIssues: number;
}): "low" | "moderate" | "high" {
  const score =
    params.highSeverityIssues * 3 +
    params.mediumSeverityIssues * 2 +
    params.lowSeverityIssues;

  if (score >= 6) return "high";
  if (score >= 2) return "moderate";
  return "low";
}
