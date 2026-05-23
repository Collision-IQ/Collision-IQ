export type InsightKey =
  | "executive_summary"
  | "support_strengths"
  | "support_gaps"
  | "financial_view"
  | "next_moves"
  | "exports";

export const INSIGHT_LABELS: Record<InsightKey, string> = {
  executive_summary: "Executive Summary",
  support_strengths: "Support Signals",
  support_gaps: "Support Gaps",
  financial_view: "Financial View",
  next_moves: "Next Moves",
  exports: "Exports",
};
