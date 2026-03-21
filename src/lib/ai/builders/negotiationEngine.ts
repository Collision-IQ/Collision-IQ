import type { AnalysisResult, RepairIntelligenceReport } from "../types/analysis";

export function generateNegotiationResponse(
  result: AnalysisResult | RepairIntelligenceReport
): string {
  const keyIssues = "findings" in result
    ? result.findings
        .filter((finding) => finding.severity === "high")
        .slice(0, 3)
        .map((finding) => ({
          title: finding.title,
          detail: finding.detail,
        }))
    : result.issues
        .filter((issue) => issue.severity === "high")
        .slice(0, 3)
        .map((issue) => ({
          title: issue.title,
          detail: issue.impact || issue.finding,
        }));

  if (!keyIssues.length) {
    return "";
  }

  const bullets = keyIssues
    .map((finding) => `- ${finding.title}: ${finding.detail}`)
    .join("\n");

  return `
Based on the current estimate, there are several areas that require clarification or correction:

${bullets}

These items are directly tied to proper repair procedures and verification. As written, the estimate does not clearly support a complete or fully validated repair process.

Please review and advise how these operations are being addressed or provide updated documentation reflecting their inclusion.
`.trim();
}
