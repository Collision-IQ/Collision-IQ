import type {
  RegulationRecord,
  RegulatoryCategory,
} from "@/lib/ai/types/analysis";

export const REGULATORY_CATEGORIES: RegulatoryCategory[] = [
  "unfair_claims_practices",
  "parts_usage",
  "repair_standards",
  "steering",
  "disclosure",
  "labor_procedures",
  "total_loss",
  "diminished_value",
];

const STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL",
  "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
  "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI",
  "WY",
];

const CATEGORY_LABELS: Record<RegulatoryCategory, string> = {
  unfair_claims_practices: "Unfair claims practices",
  parts_usage: "Parts usage",
  repair_standards: "Repair standards",
  steering: "Steering",
  disclosure: "Disclosure",
  labor_procedures: "Labor procedures",
  total_loss: "Total loss",
  diminished_value: "Diminished value",
};

export const PLACEHOLDER_CITATION =
  "TBD - requires official state source verification";

export const PLACEHOLDER_REGULATIONS: RegulationRecord[] = STATE_CODES.flatMap((state) =>
  REGULATORY_CATEGORIES.map((category) => ({
    id: `${state.toLowerCase()}-${category}`,
    state,
    category,
    rule: `${CATEGORY_LABELS[category]} placeholder for ${state}. Do not treat as a governing rule until verified from an official source.`,
    citation: PLACEHOLDER_CITATION,
    source_url: null,
    source_name: null,
    applicability:
      "Placeholder seed record only. Requires official state source verification before legal or regulatory support is asserted.",
    severity: "medium" as const,
    effective_date: null,
    retrieved_at: null,
    verified_by: null,
    notes: null,
    verification_state: "placeholder" as const,
  }))
);

export type PrismaRegulationRecord = {
  id: string;
  state: string;
  category: string;
  rule: string;
  citation: string;
  sourceUrl: string | null;
  sourceName: string | null;
  applicability: string | null;
  severity: string | null;
  effectiveDate: Date | string | null;
  retrievedAt: Date | string | null;
  verifiedBy: string | null;
  notes: string | null;
};

export function regulationFromPrismaRecord(
  record: PrismaRegulationRecord
): RegulationRecord | null {
  if (
    !record ||
    typeof record.id !== "string" ||
    typeof record.state !== "string" ||
    typeof record.category !== "string" ||
    typeof record.rule !== "string" ||
    typeof record.citation !== "string" ||
    !record.id.trim() ||
    !record.state.trim() ||
    !record.rule.trim() ||
    !record.citation.trim() ||
    !isRegulatoryCategory(record.category)
  ) {
    return null;
  }

  return {
    id: record.id,
    state: record.state.trim().toUpperCase(),
    category: record.category,
    rule: record.rule,
    citation: record.citation,
    source_url: record.sourceUrl,
    source_name: record.sourceName,
    applicability: record.applicability ?? "",
    severity: normalizeSeverity(record.severity),
    effective_date: normalizeDate(record.effectiveDate),
    retrieved_at: normalizeDate(record.retrievedAt),
    verified_by: record.verifiedBy,
    notes: record.notes,
    verification_state:
      record.citation === PLACEHOLDER_CITATION ? "placeholder" : "verified",
  };
}

export function getApplicableRegulations(
  state: string | null | undefined,
  dbRecords?: PrismaRegulationRecord[]
) {
  const normalized = state?.trim().toUpperCase();
  if (!normalized) return [];

  if (dbRecords && dbRecords.length > 0) {
    return dbRecords
      .map(regulationFromPrismaRecord)
      .filter((regulation): regulation is RegulationRecord => Boolean(regulation))
      .filter((regulation) => regulation.state === normalized);
  }

  return PLACEHOLDER_REGULATIONS.filter((regulation) => regulation.state === normalized);
}

export function getVerifiedApplicableRegulations(state: string | null | undefined) {
  return getApplicableRegulations(state).filter(
    (regulation) => regulation.verification_state === "verified"
  );
}

function isRegulatoryCategory(value: string): value is RegulatoryCategory {
  return REGULATORY_CATEGORIES.includes(value as RegulatoryCategory);
}

function normalizeSeverity(value: string | null): RegulationRecord["severity"] {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }

  return "medium";
}

function normalizeDate(value: Date | string | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
