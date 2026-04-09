export type WorkspaceData = {
  riskLevel: "low" | "moderate" | "high";
  confidence: "low" | "moderate" | "high";
  keyIssues: string[];
  estimateComparisons: Array<{
    category: string;
    shop: string;
    insurance: string;
  }>;
  supplementLetter: string;
  fullAnalysis: string;
};
