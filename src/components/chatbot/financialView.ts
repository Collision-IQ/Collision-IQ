"use client";

import type { ExportModel } from "@/lib/ai/builders/buildExportModel";
import type { AnalysisResult } from "@/lib/ai/types/analysis";
import { normalizeWorkspaceEstimateComparisons } from "@/lib/workspace/estimateComparisons";
import type { WorkspaceData } from "@/types/workspaceTypes";

export type FinancialDriver = {
  label: string;
  value: string;
};

export type ResolvedFinancialView =
  | {
      kind: "quantified_gap";
      totalGap?: string;
      drivers: FinancialDriver[];
      bullets: string[];
      narrative?: string;
    }
  | {
      kind: "directional_financial_view";
      bullets: string[];
      narrative: string;
    }
  | {
      kind: "unavailable";
      narrative: string;
    };

export function resolveFinancialView(params: {
  renderModel: ExportModel;
  normalizedResult: AnalysisResult | null;
  workspaceData: WorkspaceData | null;
}): ResolvedFinancialView {
  const normalizedComparisons = normalizeWorkspaceEstimateComparisons(
    params.workspaceData?.estimateComparisons ?? params.normalizedResult?.estimateComparisons ?? null
  );
  const quantifiedDrivers = buildQuantifiedGapDrivers(normalizedComparisons.rows);
  const modelDrivers = params.renderModel.financialGapBreakdown.drivers;
  const fallbackDrivers = modelDrivers
    .filter(
      (driver) =>
        driver.estimatedContribution &&
        !quantifiedDrivers.some(
          (item) => normalizeGapDriverKey(item.label) === normalizeGapDriverKey(driver.category)
        )
    )
    .map((driver) => ({
      label: driver.category,
      value: formatGapContribution(driver.estimatedContribution),
    }))
    .filter((driver) => driver.value);
  const allDrivers = [...quantifiedDrivers, ...fallbackDrivers];
  const totalGap =
    deriveQuantifiedTotalGap(normalizedComparisons.rows) ??
    params.renderModel.financialGapBreakdown.totalGap;
  const directionalBullets = buildDirectionalFinancialBullets(params.renderModel);
  const narrative = params.renderModel.financialGapBreakdown.narrativeSummary.trim();
  const valuationFallbackNarrative = buildValuationFallbackNarrative(params.renderModel);

  if (totalGap || allDrivers.length > 0) {
    return {
      kind: "quantified_gap",
      totalGap,
      drivers: allDrivers,
      bullets: directionalBullets,
      narrative: allDrivers.length === 0 ? narrative : undefined,
    };
  }

  if (
    hasDirectionalValuationSignal(params.renderModel) ||
    directionalBullets.length > 0 ||
    hasMeaningfulDirectionalNarrative(narrative)
  ) {
    return {
      kind: "directional_financial_view",
      bullets: directionalBullets,
      narrative:
        narrative ||
        valuationFallbackNarrative ||
        "Directional financial posture is available, but the current file set does not support quantified gap math yet.",
    };
  }

  return {
    kind: "unavailable",
    narrative:
      narrative || "The current file set does not yet support a quantified gap or directional valuation view.",
  };
}

function buildDirectionalFinancialBullets(renderModel: ExportModel) {
  const bullets: string[] = [];
  const valuation = renderModel.valuation;

  if (renderModel.financialGapBreakdown.totalGap) {
    bullets.push(`Directional total gap: ${renderModel.financialGapBreakdown.totalGap}`);
  }

  if (valuation.acvStatus === "provided" && typeof valuation.acvValue === "number") {
    bullets.push(`ACV preview: $${valuation.acvValue.toLocaleString("en-US")}`);
  } else if (valuation.acvStatus === "estimated_range" && valuation.acvRange) {
    bullets.push(
      `ACV preview band: $${valuation.acvRange.low.toLocaleString("en-US")}-$${valuation.acvRange.high.toLocaleString("en-US")}`
    );
  }

  if (valuation.dvStatus === "provided" && typeof valuation.dvValue === "number") {
    bullets.push(`Diminished value preview: $${valuation.dvValue.toLocaleString("en-US")}`);
  } else if (valuation.dvStatus === "estimated_range" && valuation.dvRange) {
    bullets.push(
      `Diminished value preview band: $${valuation.dvRange.low.toLocaleString("en-US")}-$${valuation.dvRange.high.toLocaleString("en-US")}`
    );
  }

  if (valuation.acvConfidence) {
    bullets.push(`ACV confidence: ${formatLabel(valuation.acvConfidence)}`);
  }

  if (valuation.dvConfidence) {
    bullets.push(`DV confidence: ${formatLabel(valuation.dvConfidence)}`);
  }

  if (valuation.acvMissingInputs.length > 0) {
    bullets.push(`Still needed for stronger ACV support: ${valuation.acvMissingInputs.join(", ")}`);
  }

  if (valuation.dvMissingInputs.length > 0) {
    bullets.push(`Still needed for stronger DV support: ${valuation.dvMissingInputs.join(", ")}`);
  }

  return dedupe(bullets).slice(0, 6);
}

function hasDirectionalValuationSignal(renderModel: ExportModel) {
  const valuation = renderModel.valuation;

  return Boolean(
    hasSaneRange(valuation.acvRange, 250000) ||
      hasSaneRange(valuation.dvRange, 50000) ||
      (valuation.acvStatus === "provided" && typeof valuation.acvValue === "number") ||
      (valuation.dvStatus === "provided" && typeof valuation.dvValue === "number") ||
      valuation.acvConfidence ||
      valuation.dvConfidence ||
      valuation.acvMissingInputs.length > 0 ||
      valuation.dvMissingInputs.length > 0 ||
      cleanNarrative(valuation.acvReasoning) ||
      cleanNarrative(valuation.dvReasoning)
  );
}

function buildValuationFallbackNarrative(renderModel: ExportModel) {
  const valuation = renderModel.valuation;
  const narrativeParts: string[] = [];

  const acvNarrative = cleanNarrative(valuation.acvReasoning);
  const dvNarrative = cleanNarrative(valuation.dvReasoning);

  if (acvNarrative) {
    narrativeParts.push(acvNarrative);
  }

  if (dvNarrative && dvNarrative !== acvNarrative) {
    narrativeParts.push(dvNarrative);
  }

  if (narrativeParts.length > 0) {
    return narrativeParts.join(" ");
  }

  if (valuation.acvMissingInputs.length > 0 || valuation.dvMissingInputs.length > 0) {
    return "Directional valuation support exists, but stronger financial support still depends on additional file inputs and market evidence.";
  }

  if (valuation.acvConfidence || valuation.dvConfidence) {
    return "Directional valuation posture is available from the current file set, even though quantified estimate-gap math is not yet supportable.";
  }

  return "";
}

function buildQuantifiedGapDrivers(
  rows: NonNullable<WorkspaceData["estimateComparisons"]>["rows"]
): FinancialDriver[] {
  const totals = new Map<string, number>();

  for (const row of rows) {
    if (!isCurrencyComparisonRow(row) || typeof row.delta !== "number" || !Number.isFinite(row.delta)) {
      continue;
    }

    const category = classifyFinancialGapRow(row);
    if (!category) {
      continue;
    }

    totals.set(category, (totals.get(category) ?? 0) + Math.abs(row.delta));
  }

  return [...totals.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([label, total]) => ({
      label,
      value: `-${formatCurrency(total)}`,
    }));
}

function classifyFinancialGapRow(
  row: NonNullable<WorkspaceData["estimateComparisons"]>["rows"][number]
): string | null {
  const text =
    `${row.category ?? ""} ${row.operation ?? ""} ${row.partName ?? ""} ${row.notes?.join(" ") ?? ""}`.toLowerCase();

  if (/(paint|refinish|blend|tint|mask|clear|prime)/.test(text)) {
    return "Paint / Refinish gap";
  }
  if (/(labor|rate|body|frame|structural|measure|setup|pull|align|alignment)/.test(text)) {
    return "Labor / Structural process gap";
  }
  if (/(adas|calibration|scan|diagnostic|sensor|camera|radar)/.test(text)) {
    return "Calibration / Diagnostics gap";
  }
  if (/(oem|aftermarket|alternate|alt\b|parts|suspension|hardware|clip|seal)/.test(text)) {
    return "Parts strategy gap";
  }
  if (/(corrosion|cavity wax|material|materials|sealer|test fit|fit check)/.test(text)) {
    return "Process / Materials gap";
  }

  return null;
}

function deriveQuantifiedTotalGap(
  rows: NonNullable<WorkspaceData["estimateComparisons"]>["rows"]
): string | undefined {
  const numericRows = rows.filter(
    (row) => isCurrencyComparisonRow(row) && typeof row.delta === "number" && Number.isFinite(row.delta)
  );
  if (numericRows.length === 0) {
    return undefined;
  }

  const total = numericRows.reduce((sum, row) => sum + Math.abs(Number(row.delta)), 0);
  if (!Number.isFinite(total) || total <= 0) {
    return undefined;
  }

  return `${formatCurrency(total)} (directional only)`;
}

function isCurrencyComparisonRow(
  row: NonNullable<WorkspaceData["estimateComparisons"]>["rows"][number]
): boolean {
  if (row.valueUnit === "currency") {
    return true;
  }

  const text = `${row.category ?? ""} ${row.operation ?? ""}`.toLowerCase();
  return /\b(?:estimate total|total cost|labor rate|paint rate|refinish rate)\b/.test(text);
}

function normalizeGapDriverKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function formatGapContribution(value?: string): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("-") || trimmed.startsWith("+")) {
    return trimmed;
  }

  return `-${trimmed}`;
}

function formatCurrency(value: number, includeCents = false): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: includeCents ? 2 : 0,
    maximumFractionDigits: includeCents ? 2 : 0,
  }).format(value);
}

function formatLabel(value: string | undefined | null): string {
  if (!value) return "Pending";
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function dedupe(items: Array<string | undefined | null>) {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const normalized = item?.replace(/\s+/g, " ").trim();
    if (!normalized) continue;

    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function hasMeaningfulDirectionalNarrative(value: string) {
  if (!value) return false;

  return !/(not yet quantified|not supportable|does not yet support|not determinable)/i.test(value);
}

function hasSaneRange(
  range: { low: number; high: number } | undefined,
  max: number
): range is { low: number; high: number } {
  if (!range) return false;
  if (!Number.isFinite(range.low) || !Number.isFinite(range.high)) return false;
  if (range.low <= 0 || range.high <= 0) return false;
  if (range.high < range.low || range.high > max) return false;
  return true;
}

function cleanNarrative(value: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (/preview band not supportable from the current file set/i.test(cleaned)) {
    return "";
  }
  if (/not determinable from the current documents/i.test(cleaned)) {
    return "";
  }
  return cleaned;
}
