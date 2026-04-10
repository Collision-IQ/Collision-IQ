import type { RepairIntelligenceReport } from "@/lib/ai/types/analysis";
import type { WorkspaceData } from "@/types/workspaceTypes";
import { getStructuredEstimateComparisons } from "@/lib/workspace/estimateComparisons";

export function buildWorkspaceDataFromReport(
  report: RepairIntelligenceReport
): WorkspaceData {
  const keyIssues = dedupeStrings([
    ...report.issues.map((issue) =>
      [issue.title, issue.impact || issue.finding].filter(Boolean).join(": ")
    ),
    ...report.missingProcedures.map((procedure) => `Missing procedure: ${procedure}`),
    ...report.supplementOpportunities,
  ]).slice(0, 5);

  return {
    riskLevel: report.summary.riskScore,
    confidence: report.summary.confidence,
    keyIssues,
    // The Workspace consumes this structured comparison field directly so the
    // UI and exports do not have to re-parse assistant prose to recover rows.
    estimateComparisons: getStructuredEstimateComparisons(report.analysis),
    supplementLetter: buildWorkspaceSupplementLetter(keyIssues),
    fullAnalysis: buildWorkspaceFullAnalysis(report, keyIssues),
  };
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function buildWorkspaceSupplementLetter(issues: string[]): string {
  if (!issues.length) return "";

  const numberedIssues = issues.map((issue, index) => `${index + 1}. ${issue}`).join("\n");

  return `Subject: Request for Repair Supplement

After reviewing the repair estimate and related documentation, several issues
have been identified that may affect repair safety, OEM compliance, or repair
quality. These items should be addressed before proceeding with repairs.

Identified Issues:
${numberedIssues}

Based on these findings, we respectfully request authorization for the
appropriate adjustments to ensure the repair follows OEM procedures and
industry standards.

Please advise if additional documentation is required.

Sincerely,
Repair Review System
Collision-IQ
`;
}

function buildWorkspaceFullAnalysis(
  report: RepairIntelligenceReport,
  keyIssues: string[]
): string {
  const sections = [
    report.analysis?.narrative?.trim() || "",
    report.recommendedActions.length
      ? `Recommended actions:\n${report.recommendedActions.map((action) => `- ${action}`).join("\n")}`
      : "",
    keyIssues.length ? `Key issues:\n${keyIssues.map((issue) => `- ${issue}`).join("\n")}` : "",
  ].filter(Boolean);

  return sections.join("\n\n");
}
