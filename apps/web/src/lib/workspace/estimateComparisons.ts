import type { AnalysisResult } from "@/lib/ai/types/analysis";
import type {
  EstimateComparisonRow,
  WorkspaceEstimateComparisons,
} from "@/types/workspaceTypes";

type LegacyComparisonRow = {
  id?: string;
  category?: string;
  shop?: string;
  insurance?: string;
  lhsSource?: string;
  rhsSource?: string;
  lhsValue?: string | number | null;
  rhsValue?: string | number | null;
  delta?: string | number | null;
  valueUnit?: EstimateComparisonRow["valueUnit"];
  deltaType?: EstimateComparisonRow["deltaType"];
  confidence?: number | null;
  notes?: string[];
  operation?: string;
  partName?: string;
};

export const EMPTY_WORKSPACE_ESTIMATE_COMPARISONS: WorkspaceEstimateComparisons = {
  rows: [],
  summary: {
    totalRows: 0,
    changedRows: 0,
    addedRows: 0,
    removedRows: 0,
    sameRows: 0,
  },
};

export function normalizeWorkspaceEstimateComparisons(
  value: unknown
): WorkspaceEstimateComparisons {
  if (!value) {
    return {
      rows: [],
      summary: buildWorkspaceEstimateComparisonSummary([]),
    };
  }

  const rawRows = Array.isArray(value)
    ? value
    : typeof value === "object" && value && "rows" in value && Array.isArray(value.rows)
      ? value.rows
      : [];

  const rows = rawRows
    .map((row, index) => normalizeEstimateComparisonRow(row as LegacyComparisonRow, index))
    .filter((row): row is EstimateComparisonRow => Boolean(row));

  return {
    rows,
    summary: buildWorkspaceEstimateComparisonSummary(rows),
  };
}

export function getStructuredEstimateComparisons(
  analysis?: AnalysisResult | null
): WorkspaceEstimateComparisons {
  return normalizeWorkspaceEstimateComparisons(analysis?.estimateComparisons);
}

function normalizeEstimateComparisonRow(
  row: LegacyComparisonRow,
  index: number
): EstimateComparisonRow | null {
  if (!row || typeof row !== "object") {
    return null;
  }

  const lhsValue = row.lhsValue ?? row.shop ?? null;
  const rhsValue = row.rhsValue ?? row.insurance ?? null;

  return {
    id: row.id ?? `comparison-row-${index + 1}`,
    category: row.category ?? "Estimate comparison",
    operation: row.operation,
    partName: row.partName,
    lhsSource: row.lhsSource ?? "Shop estimate",
    rhsSource: row.rhsSource ?? "Carrier estimate",
    lhsValue,
    rhsValue,
    delta: row.delta ?? deriveDelta(lhsValue, rhsValue),
    valueUnit: row.valueUnit,
    deltaType: row.deltaType ?? deriveDeltaType(lhsValue, rhsValue),
    confidence: typeof row.confidence === "number" ? row.confidence : null,
    notes: row.notes?.filter(Boolean) ?? [],
  };
}

function deriveDeltaType(
  lhsValue: EstimateComparisonRow["lhsValue"],
  rhsValue: EstimateComparisonRow["rhsValue"]
): EstimateComparisonRow["deltaType"] {
  if (hasValue(lhsValue) && !hasValue(rhsValue)) return "added";
  if (!hasValue(lhsValue) && hasValue(rhsValue)) return "removed";
  if (!hasValue(lhsValue) && !hasValue(rhsValue)) return "unknown";
  if (String(lhsValue).trim() === String(rhsValue).trim()) return "same";
  return "changed";
}

function deriveDelta(
  lhsValue: EstimateComparisonRow["lhsValue"],
  rhsValue: EstimateComparisonRow["rhsValue"]
): string | number | null {
  if (typeof lhsValue === "number" && typeof rhsValue === "number") {
    return Number((lhsValue - rhsValue).toFixed(2));
  }

  const deltaType = deriveDeltaType(lhsValue, rhsValue);
  if (deltaType === "added") return "Only on left";
  if (deltaType === "removed") return "Only on right";
  if (deltaType === "same") return "Aligned";
  if (deltaType === "changed") return "Changed";
  return null;
}

export function buildWorkspaceEstimateComparisonSummary(
  rows: EstimateComparisonRow[]
): NonNullable<WorkspaceEstimateComparisons["summary"]> {
  return {
    totalRows: rows.length,
    changedRows: rows.filter((row) => row.deltaType === "changed").length,
    addedRows: rows.filter((row) => row.deltaType === "added").length,
    removedRows: rows.filter((row) => row.deltaType === "removed").length,
    sameRows: rows.filter((row) => row.deltaType === "same").length,
  };
}

function hasValue(value: EstimateComparisonRow["lhsValue"]) {
  return value !== null && value !== undefined && `${value}`.trim().length > 0;
}
