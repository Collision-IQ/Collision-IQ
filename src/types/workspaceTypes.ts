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
  /** Stable ID of the CanonicalDeltaSet this row was derived from. Present when the row was produced by canonicalDeltaSetToEstimateComparisons. */
  canonicalDeltaObjectId?: string;
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
  /** Stable ID of the CanonicalDeltaSet that produced these rows, when applicable. Repair Intelligence, Snapshot, and Customer Report consumers use this to trace rendered deltas back to the canonical object. */
  canonicalDeltaObjectId?: string;
};

export type WorkspaceData = {
  riskLevel: "low" | "moderate" | "high";
  confidence: "low" | "moderate" | "high";
  keyIssues: string[];
  estimateComparisons: WorkspaceEstimateComparisons;
  supplementLetter: string;
  fullAnalysis: string;
};
