import type { AnalysisResult, RepairIntelligenceReport } from "../types/analysis";
import { buildSupplementLines } from "./supplementBuilder";

export function generateNegotiationResponse(
  result: AnalysisResult | RepairIntelligenceReport
): string {
  const supplements = buildSupplementLines(result);

  if (supplements.length === 0) {
    return "The estimate appears to support a complete repair process based on the documented operations.";
  }

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
    .filter((finding) =>
      supplements.some(
        (item) => item.title.toLowerCase() === finding.title.toLowerCase() || finding.detail.toLowerCase().includes(item.title.toLowerCase())
      )
    )
    .map((finding) => `- ${finding.title}: ${finding.detail}`)
    .join("\n");

  if (!bullets.trim()) {
    return [
      "Based on the current estimate, the clearest remaining support gaps are:",
      "",
      ...supplements.slice(0, 5).map((item) => `- ${item.title}: ${item.rationale}`),
      "",
      "Please review and advise how these operations are being addressed or provide updated documentation reflecting their inclusion.",
    ].join("\n");
  }

  return `
Based on the current estimate, there are several areas that require clarification or correction:

${bullets}

These items are directly tied to proper repair procedures and verification. As written, the estimate does not clearly support a complete or fully validated repair process.

Please review and advise how these operations are being addressed or provide updated documentation reflecting their inclusion.
`.trim();
}
