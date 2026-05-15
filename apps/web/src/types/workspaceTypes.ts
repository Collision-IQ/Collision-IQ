export type EstimateComparisonRow = {
  id: string;
  category?: string;
  operation?: string;
  partName?: string;
  lhsSource?: string;
  rhsSource?: string;
  lhsValue?: string | number | null;
  rhsValue?: string | number | null;
  delta?: string | number | null;
  valueUnit?: "currency" | "hours" | "count" | "text";
  deltaType?: "added" | "removed" | "changed" | "same" | "unknown";
  confidence?: number | null;
  notes?: string[];
};

export type WorkspaceEstimateComparisons = {
  rows: EstimateComparisonRow[];
  summary?: {
    totalRows: number;
    changedRows: number;
    addedRows: number;
    removedRows: number;
    sameRows: number;
  };
};

export type WorkspaceData = {
  riskLevel: "low" | "moderate" | "high";
  confidence: "low" | "moderate" | "high";
  keyIssues: string[];
  estimateComparisons: WorkspaceEstimateComparisons;
  supplementLetter: string;
  fullAnalysis: string;
};
