import type { AnalysisResult } from "@/lib/ai/types/analysis";
import type {
  EstimateComparisonRow,
  WorkspaceEstimateComparisons,
} from "@/types/workspaceTypes";
import { normalizeEstimateOperationLabel } from "@/lib/ui/presentationText";

type LegacyComparisonRow = {
  id?: string;
  category?: string;
  description?: string;
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
  const normalizedOperation = normalizeEstimateOperationLabel({
    description: row.description,
    operation: row.operation,
    partName: row.partName,
    category: row.category,
  });
  const directOperation = normalizeEstimateOperationLabel(row.operation);
  const displayOperation =
    directOperation && isGenericComparisonCategory(normalizedOperation, row.category)
      ? directOperation
      : normalizedOperation || directOperation || row.operation;

  const normalized: EstimateComparisonRow = {
    id: row.id ?? `comparison-row-${index + 1}`,
    category: row.category ?? "Estimate comparison",
    operation: displayOperation,
    partName: row.partName,
    lhsSource: row.lhsSource ?? "Shop estimate",
    rhsSource: row.rhsSource ?? "Carrier estimate",
    lhsValue,
    rhsValue,
    delta: row.delta ?? deriveDelta(lhsValue, rhsValue),
    valueUnit: row.valueUnit,
    deltaType: row.deltaType ?? deriveDeltaType(lhsValue, rhsValue),
    confidence: typeof row.confidence === "number" ? row.confidence : null,
    notes: row.notes?.filter(isMeaningfulComparisonNote) ?? [],
  };

  return hasMeaningfulComparisonRow(normalized) ? normalized : null;
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
    return Number((rhsValue - lhsValue).toFixed(2));
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

function hasMeaningfulComparisonRow(row: EstimateComparisonRow) {
  const labels = [row.operation, row.partName, row.category]
    .map((value) => normalizeComparisonLabel(value))
    .filter(Boolean);

  if (labels.some((label) => !isGenericOperationToken(label))) {
    return true;
  }

  const text = `${row.category ?? ""} ${row.notes?.join(" ") ?? ""}`.toLowerCase();
  if (/\b(total|subtotal|tax|labor|body|paint|frame|structural|scan|calibration|alignment|measurement|parts?)\b/.test(text)) {
    return true;
  }

  return false;
}

function normalizeComparisonLabel(value: string | null | undefined) {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericOperationToken(value: string) {
  return /^(?:r&i|r&r|repl|rpr|refn|o\/h|subl|add|overlap|repair operation|operation|estimate comparison)$/i.test(
    value
  );
}

function isGenericComparisonCategory(value: string, category: string | undefined) {
  if (!value || !category) return false;
  return value.trim().toLowerCase() === category.trim().toLowerCase();
}

function isMeaningfulComparisonNote(value: string | null | undefined): value is string {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return false;

  const withoutEvidenceIds = cleaned
    .replace(/\bEvidence references?:\s*/gi, "")
    .replace(/\b(?:cmp[a-z0-9-]{6,}|[a-f0-9]{24,}|[a-f0-9]{8}-[a-f0-9-]{27,})\b/gi, "")
    .replace(/[,\s.;:]+/g, " ")
    .trim();

  return withoutEvidenceIds.length > 0;
}
