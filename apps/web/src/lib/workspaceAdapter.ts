/**
 * workspaceAdapter.ts
 *
 * TEMPORARY legacy compatibility layer.
 *
 * This file converts raw assistant prose into a WorkspaceData object so that
 * older Workspace callers can keep rendering while the backend becomes the
 * source of truth for structured workspaceData.
 *
 * TODO: Replace buildWorkspaceDataFromAnalysisText entirely once the /api/analysis
 * route is reliably returning WorkspaceData everywhere that needs it. At that
 * point this file can be deleted and callers should pass backend-generated data
 * directly.
 */

import type { WorkspaceData } from "@/types/workspaceTypes";
import { normalizeWorkspaceEstimateComparisons } from "@/lib/workspace/estimateComparisons";

// ---------------------------------------------------------------------------
// Legacy text-parsing helpers (ported from the original WorkspacePanel parsing
// functions). These are intentionally heuristic and should remain fallback-only.
// ---------------------------------------------------------------------------

function extractIssues(text: string): string[] {
  const issues: string[] = [];
  const lines = text.split("\n");

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (
      lower.includes("risk") ||
      lower.includes("exposure") ||
      lower.includes("missing") ||
      lower.includes("gap") ||
      lower.includes("violate")
    ) {
      issues.push(line.replace(/[-*]/g, "").trim());
    }
  }

  return issues.slice(0, 5);
}

function extractComparison(text: string) {
  const rows: Array<{
    category: string;
    lhsValue: string;
    rhsValue: string;
  }> = [];
  const lines = text.split("\n");
  let currentCategory = "";

  for (const line of lines) {
    const clean = line.replace(/[-*]/g, "").trim();
    const lower = clean.toLowerCase();

    if (
      lower.includes("scope") ||
      lower.includes("labor") ||
      lower.includes("parts") ||
      lower.includes("refinish") ||
      lower.includes("adas")
    ) {
      currentCategory = clean.replace(":", "");
    }

    if (lower.startsWith("shop estimate")) {
      rows.push({
        category: currentCategory,
        lhsValue: clean.replace("Shop Estimate:", "").trim(),
        rhsValue: "",
      });
    }

    if (lower.startsWith("insurance estimate")) {
      const last = rows[rows.length - 1];
      if (last) {
        last.rhsValue = clean.replace("Insurance Estimate:", "").trim();
      }
    }
  }

  return normalizeWorkspaceEstimateComparisons(
    rows.slice(0, 5).map((row, index) => ({
      id: `legacy-comparison-${index + 1}`,
      category: row.category,
      lhsSource: "Shop estimate",
      rhsSource: "Carrier estimate",
      lhsValue: row.lhsValue,
      rhsValue: row.rhsValue,
    }))
  );
}

function deriveRiskLevel(issueCount: number): WorkspaceData["riskLevel"] {
  if (issueCount > 2) return "high";
  if (issueCount > 0) return "moderate";
  return "low";
}

function buildSupplementLetter(issues: string[]): string {
  if (!issues.length) return "";

  const intro = `Subject: Request for Repair Supplement

After reviewing the repair estimate and related documentation, several issues
have been identified that may affect repair safety, OEM compliance, or repair
quality. These items should be addressed before proceeding with repairs.

Identified Issues:
`;

  const list = issues.map((issue, idx) => `${idx + 1}. ${issue}`).join("\n");

  const closing = `

Based on these findings, we respectfully request authorization for the
appropriate adjustments to ensure the repair follows OEM procedures and
industry standards.

Please advise if additional documentation is required.

Sincerely,
Repair Review System
Collision-IQ
`;

  return intro + list + closing;
}

// ---------------------------------------------------------------------------
// Public adapter
// ---------------------------------------------------------------------------

/**
 * Converts raw assistant analysis text into a WorkspaceData object.
 *
 * TEMPORARY LEGACY FALLBACK:
 * This function uses text-scanning heuristics and is intentionally fragile.
 * It exists only to keep the UI working when backend workspaceData is missing.
 *
 * Replace remaining calls to this function with backend-returned WorkspaceData
 * once /api/analysis emits that shape consistently.
 */
export function buildWorkspaceDataFromAnalysisText(analysis?: string): WorkspaceData {
  if (!analysis) {
    return {
      riskLevel: "low",
      confidence: "low",
      keyIssues: [],
      estimateComparisons: normalizeWorkspaceEstimateComparisons(null),
      supplementLetter: "",
      fullAnalysis: "",
    };
  }

  const keyIssues = extractIssues(analysis);
  const estimateComparisons = extractComparison(analysis);

  return {
    riskLevel: deriveRiskLevel(keyIssues.length),
    confidence: "moderate",
    keyIssues,
    estimateComparisons,
    supplementLetter: buildSupplementLetter(keyIssues),
    fullAnalysis: analysis,
  };
}
