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
    return [
      "Based on the current estimate and supporting file, the clearest repair-support items to review are:",
      "",
      ...supplements.slice(0, 5).map((item) => `- ${item.title}: ${item.rationale}`),
      "",
      "Please review whether these items are already supported, whether the OEM material materially adds to the repair path, and what should be added or documented more clearly.",
    ].join("\n");
  }

  const bullets = keyIssues
    .filter((finding) =>
      supplements.some(
        (item) => item.title.toLowerCase() === finding.title.toLowerCase() || finding.detail.toLowerCase().includes(item.title.toLowerCase())
      )
    )
    .map((finding) => `- ${finding.title}: ${finding.detail}`)
    .join("\n");
  const supplementBullets = supplements
    .slice(0, 5)
    .map((item) => `- ${item.title}: ${item.rationale}`)
    .join("\n");

  if (!bullets.trim()) {
    return [
      "Based on the current estimate and supporting file, the clearest repair-support items to review are:",
      "",
      ...supplements.slice(0, 5).map((item) => `- ${item.title}: ${item.rationale}`),
      "",
      "Please review whether these items are already supported, whether the OEM material materially adds to the repair path, and what should be added or documented more clearly.",
    ].join("\n");
  }

  return `
Based on the current estimate and supporting file, several repair-support items remain worth clarifying:

${bullets}

Supporting items identified from the current file:

${supplementBullets}

These items affect how well the file supports the intended repair path, verification burden, and related documentation.

Please review whether these items are already supported, whether the OEM material materially adds to the repair path, and what should be added or documented more clearly.
`.trim();
}
