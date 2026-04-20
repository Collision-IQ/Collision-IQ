import type { RepairIntelligenceReport } from "@/lib/ai/types/analysis";
import type { WorkspaceData } from "@/types/workspaceTypes";
import { getStructuredEstimateComparisons } from "@/lib/workspace/estimateComparisons";
import { analyzeEstimateOperations } from "@/lib/ai/estimateOperationEquivalence";
import {
  deriveImpactZone,
  hasFrontSupportZoneEvidence,
  isSideImpactZone,
} from "@/lib/ai/impactZone";
import { redactExternalDocumentUrls } from "@/lib/externalDocuments";

export function buildWorkspaceDataFromReport(
  report: RepairIntelligenceReport
): WorkspaceData {
  const operationSnapshot = analyzeEstimateOperations(
    [report.sourceEstimateText ?? "", report.analysis?.rawEstimateText ?? ""].join("\n")
  );
  const sourceText = [report.sourceEstimateText ?? "", report.analysis?.rawEstimateText ?? ""].join("\n");
  const keyIssues = filterKeyIssuesForImpactZone(filterKeyIssuesForRepresentedOperations(dedupeStrings([
    ...report.issues.map((issue) =>
      [issue.title, issue.impact || issue.finding].filter(Boolean).join(": ")
    ),
    ...report.missingProcedures.map((procedure) => `Missing procedure: ${procedure}`),
    ...report.supplementOpportunities,
  ]).map(redactExternalDocumentUrls), operationSnapshot), sourceText).slice(0, 5);

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

function filterKeyIssuesForImpactZone(issues: string[], sourceText: string): string[] {
  const impactZone = deriveImpactZone({ text: sourceText });
  if (
    !isSideImpactZone(impactZone) ||
    impactZone.confidence === "low" ||
    hasFrontSupportZoneEvidence(sourceText)
  ) {
    return issues;
  }

  return issues.map((issue) => {
    if (!/(front support|front-end|hidden mounting|mounting geometry|teardown growth)/i.test(issue)) {
      return issue;
    }

    return issue.replace(
      /(?:Front Support Area Verification|Hidden Mounting Geometry \/ Teardown Growth|front-end damage|front support|mounting geometry)/gi,
      "Side structure / aperture fit verification"
    );
  });
}

function filterKeyIssuesForRepresentedOperations(
  issues: string[],
  operations: ReturnType<typeof analyzeEstimateOperations>
): string[] {
  return issues.filter((issue) => {
    const lower = issue.toLowerCase();
    if (
      (lower.includes("headlamp") || lower.includes("headlight") || lower.includes("lamp aim")) &&
      lower.includes("missing") &&
      (operations.headlamp_aim || operations.fog_lamp_aim)
    ) {
      return false;
    }
    if (
      (lower.includes("suspension") || lower.includes("alignment") || lower.includes("steering")) &&
      lower.includes("missing") &&
      (operations.alignment || operations.suspension_steering)
    ) {
      return false;
    }
    if (
      (lower.includes("scan") || lower.includes("calibration")) &&
      lower.includes("missing") &&
      (operations.scan || operations.calibration)
    ) {
      return false;
    }
    return true;
  });
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
