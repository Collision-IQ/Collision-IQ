/**
 * FORENSIC ESTIMATE ANALYSIS & REPAIR COST GAP REPORT — model layer.
 *
 * This is the second document of the Citation Density Report: a line-level
 * reconciliation of two appraisals of the same loss, written to be read by a
 * claims professional and by the vehicle owner. It replaces BOTH findings
 * reports and the OEM annotated estimate.
 *
 * DIVISION OF LABOUR, and the reason for it. Every number in this model is
 * derived from the two documents' own parsed totals blocks and matched line
 * rows — none is inferred, and the reconciliation is required to balance to the
 * cent against both grand totals. Narrative judgement (which findings lead, how
 * a difference is characterised) is layered ON TOP of this model, never inside
 * it: a sentence that cannot point at a row in here does not belong in the
 * report. That boundary is what keeps the document defensible when an appraiser
 * or an attorney checks it against the source estimates.
 *
 * The reconciliation deliberately FAILS LOUD. If the category rows do not sum
 * to the printed subtotal, or the subtotal plus tax does not reach the printed
 * grand total, the model records the discrepancy instead of quietly presenting
 * numbers that do not add up. A reconciliation that silently disagrees with the
 * document it claims to reconcile is worse than no reconciliation.
 */
import type {
  EstimateTotalsCategory,
  EstimateTotalsSummary,
} from "./estimateDeltaMatcher";
import { normalizeTotalsCategoryKey } from "./estimateDeltaMatcher";

/** Cent-accurate comparison. Float sums drift; money does not. */
const cents = (value: number | null | undefined): number | null =>
  value === null || value === undefined || !Number.isFinite(value)
    ? null
    : Math.round(value * 100);

const fromCents = (value: number | null): number | null =>
  value === null ? null : value / 100;

/** Two money values agree if they agree to the cent. No epsilon fudge. */
function sameMoney(a: number | null, b: number | null): boolean {
  const ca = cents(a);
  const cb = cents(b);
  return ca !== null && cb !== null && ca === cb;
}

export type ReconciliationRow = {
  /** Category label as printed on the document that carries it. */
  category: string;
  /** Stable key used to pair the two documents' rows. */
  categoryKey: string;
  higherHours: number | null;
  higherRate: number | null;
  higherCost: number | null;
  lowerHours: number | null;
  lowerRate: number | null;
  lowerCost: number | null;
  /** lower minus higher. Negative = the lower estimate allows less. */
  costDifference: number | null;
  hoursDifference: number | null;
  /** True when both documents print the same rate for this category. */
  ratesAgree: boolean;
  /** Present on exactly one document — a category the other does not carry. */
  presentOnlyOn: "higher" | "lower" | null;
};

export type ReconciliationCheck = {
  /** Did the category rows sum to the document's own printed subtotal? */
  categoriesSumToSubtotal: boolean;
  /** Did subtotal + tax reach the document's own printed grand total? */
  subtotalPlusTaxReachesGrandTotal: boolean;
  /** Signed cent discrepancies, for the limitations section. Zero when clean. */
  subtotalDiscrepancy: number | null;
  grandTotalDiscrepancy: number | null;
};

export type ForensicReconciliation = {
  rows: ReconciliationRow[];
  higherSubtotal: number | null;
  lowerSubtotal: number | null;
  higherTax: number | null;
  lowerTax: number | null;
  higherGrandTotal: number | null;
  lowerGrandTotal: number | null;
  /** The headline number: lower grand total minus higher grand total. */
  grandTotalDifference: number | null;
  /** Tax lanes one document charges and the other does not. */
  unmatchedTaxLanes: Array<{ label: string; amount: number; onlyOn: "higher" | "lower" }>;
  /**
   * Whether EVERY category rate that both documents print is identical. When
   * true the report can state plainly that no rate dispute exists and the whole
   * labour gap is hours and operations — the single most useful sentence in the
   * document, and one that must never be asserted without this check.
   */
  allSharedRatesAgree: boolean;
  higherCheck: ReconciliationCheck;
  lowerCheck: ReconciliationCheck;
  /** True only when both documents reconcile against their own printed totals. */
  balances: boolean;
};

function checkDocument(totals: EstimateTotalsSummary | null): ReconciliationCheck {
  if (!totals) {
    return {
      categoriesSumToSubtotal: false,
      subtotalPlusTaxReachesGrandTotal: false,
      subtotalDiscrepancy: null,
      grandTotalDiscrepancy: null,
    };
  }
  const categorySum = totals.categories.reduce<number | null>((sum, category) => {
    const value = cents(category.cost);
    if (sum === null || value === null) return sum === null ? null : sum;
    return sum + value;
  }, 0);
  const subtotal = cents(totals.subtotal);
  const tax = cents(totals.salesTax) ?? 0;
  const grandTotal = cents(totals.grandTotal);

  const subtotalDiscrepancy =
    categorySum !== null && subtotal !== null ? categorySum - subtotal : null;
  const grandTotalDiscrepancy =
    subtotal !== null && grandTotal !== null ? subtotal + tax - grandTotal : null;

  return {
    categoriesSumToSubtotal: subtotalDiscrepancy === 0,
    subtotalPlusTaxReachesGrandTotal: grandTotalDiscrepancy === 0,
    subtotalDiscrepancy,
    grandTotalDiscrepancy,
  };
}

function indexCategories(
  totals: EstimateTotalsSummary | null
): Map<string, EstimateTotalsCategory> {
  const index = new Map<string, EstimateTotalsCategory>();
  for (const category of totals?.categories ?? []) {
    const key = normalizeTotalsCategoryKey(category.category);
    // A document that prints the same concept twice (supplement roll-ups do)
    // must not lose either row; sum them rather than letting the last win.
    const existing = index.get(key);
    if (!existing) {
      index.set(key, category);
      continue;
    }
    index.set(key, {
      category: existing.category,
      hours: existing.hours !== null || category.hours !== null
        ? (existing.hours ?? 0) + (category.hours ?? 0)
        : null,
      // Rates do not sum. Keep the rate only while both rows agree on it;
      // a merged row with conflicting rates has no single rate to report.
      rate: existing.rate !== null && sameMoney(existing.rate, category.rate) ? existing.rate : null,
      cost: existing.cost !== null || category.cost !== null
        ? (existing.cost ?? 0) + (category.cost ?? 0)
        : null,
    });
  }
  return index;
}

/**
 * Build the Section 4 reconciliation from both documents' printed totals.
 *
 * `higher` is the higher-cost appraisal (the annotated one); `lower` is the
 * document being compared against it. Differences are expressed as lower minus
 * higher, so a negative figure reads "the lower estimate allows this much less"
 * — the direction a reader of a cost-gap report expects.
 */
export function buildForensicReconciliation(params: {
  higherTotals: EstimateTotalsSummary | null;
  lowerTotals: EstimateTotalsSummary | null;
}): ForensicReconciliation {
  const { higherTotals, lowerTotals } = params;
  const higherIndex = indexCategories(higherTotals);
  const lowerIndex = indexCategories(lowerTotals);

  // Higher-document order first (it is the document being annotated, so its
  // ordering is the one the reader is holding), then lower-only categories.
  const orderedKeys = [
    ...higherIndex.keys(),
    ...[...lowerIndex.keys()].filter((key) => !higherIndex.has(key)),
  ];

  const rows: ReconciliationRow[] = orderedKeys.map((categoryKey) => {
    const higher = higherIndex.get(categoryKey) ?? null;
    const lower = lowerIndex.get(categoryKey) ?? null;
    const higherCost = higher?.cost ?? null;
    const lowerCost = lower?.cost ?? null;
    const higherHours = higher?.hours ?? null;
    const lowerHours = lower?.hours ?? null;
    return {
      category: higher?.category ?? lower?.category ?? categoryKey,
      categoryKey,
      higherHours,
      higherRate: higher?.rate ?? null,
      higherCost,
      lowerHours,
      lowerRate: lower?.rate ?? null,
      lowerCost,
      costDifference:
        higherCost !== null && lowerCost !== null
          ? fromCents((cents(lowerCost) ?? 0) - (cents(higherCost) ?? 0))
          : null,
      hoursDifference:
        higherHours !== null && lowerHours !== null
          ? Math.round((lowerHours - higherHours) * 10) / 10
          : null,
      // Only meaningful when both documents price the category.
      ratesAgree:
        higher?.rate !== null && higher?.rate !== undefined && sameMoney(higher.rate, lower?.rate ?? null),
      presentOnlyOn: higher && !lower ? "higher" : lower && !higher ? "lower" : null,
    };
  });

  const higherGrandTotal = higherTotals?.grandTotal ?? null;
  const lowerGrandTotal = lowerTotals?.grandTotal ?? null;

  const higherLaneKeys = new Set((higherTotals?.taxLanes ?? []).map((lane) => lane.label.toLowerCase()));
  const lowerLaneKeys = new Set((lowerTotals?.taxLanes ?? []).map((lane) => lane.label.toLowerCase()));
  const unmatchedTaxLanes = [
    ...(higherTotals?.taxLanes ?? [])
      .filter((lane) => !lowerLaneKeys.has(lane.label.toLowerCase()))
      .map((lane) => ({ ...lane, onlyOn: "higher" as const })),
    ...(lowerTotals?.taxLanes ?? [])
      .filter((lane) => !higherLaneKeys.has(lane.label.toLowerCase()))
      .map((lane) => ({ ...lane, onlyOn: "lower" as const })),
  ];

  // "No rate dispute" may be claimed only across categories BOTH documents
  // price. A category only one side carries has no shared rate to agree on,
  // and counting it as disagreement would suppress a true and useful statement.
  const sharedRateRows = rows.filter(
    (row) => row.higherRate !== null && row.lowerRate !== null
  );
  const allSharedRatesAgree =
    sharedRateRows.length > 0 && sharedRateRows.every((row) => row.ratesAgree);

  const higherCheck = checkDocument(higherTotals);
  const lowerCheck = checkDocument(lowerTotals);

  return {
    rows,
    higherSubtotal: higherTotals?.subtotal ?? null,
    lowerSubtotal: lowerTotals?.subtotal ?? null,
    higherTax: higherTotals?.salesTax ?? null,
    lowerTax: lowerTotals?.salesTax ?? null,
    higherGrandTotal,
    lowerGrandTotal,
    grandTotalDifference:
      higherGrandTotal !== null && lowerGrandTotal !== null
        ? fromCents((cents(lowerGrandTotal) ?? 0) - (cents(higherGrandTotal) ?? 0))
        : null,
    unmatchedTaxLanes,
    allSharedRatesAgree,
    higherCheck,
    lowerCheck,
    balances:
      higherCheck.categoriesSumToSubtotal &&
      higherCheck.subtotalPlusTaxReachesGrandTotal &&
      lowerCheck.categoriesSumToSubtotal &&
      lowerCheck.subtotalPlusTaxReachesGrandTotal,
  };
}

/**
 * Sentences the reconciliation is allowed to support, and no others.
 *
 * Returned as data rather than rendered prose so the caller (and a test) can
 * see exactly which claims the numbers license. `rateDisputeStatement` is null
 * when the rates do NOT all agree — the report then says nothing about rates
 * rather than asserting a dispute it has not characterised.
 */
export function describeReconciliation(reconciliation: ForensicReconciliation): {
  gapStatement: string | null;
  rateDisputeStatement: string | null;
  /** Named rate differences, when the categories do NOT all agree. */
  rateDifferences: string[];
  /** Categories where the COMPARISON allows more, stated plainly. */
  comparisonAllowsMore: string[];
  balanceWarnings: string[];
} {
  const money = (value: number) =>
    `$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const gapStatement =
    reconciliation.grandTotalDifference !== null &&
    reconciliation.higherGrandTotal !== null &&
    reconciliation.lowerGrandTotal !== null
      ? `The two appraisals differ by ${money(reconciliation.grandTotalDifference)} ` +
        `(${money(reconciliation.higherGrandTotal)} against ${money(reconciliation.lowerGrandTotal)}).`
      : null;

  const rateDisputeStatement = reconciliation.allSharedRatesAgree
    ? "Every labour rate printed on both documents matches exactly; this report raises no rate dispute. " +
      "The labour difference is a function of hours allowed and operations included."
    : null;

  // A rate gap is one of the largest and most arguable drivers in any file, and
  // it applies across every hour in the category. Reporting it only as one
  // finding among dozens buries it; it belongs beside the reconciliation the
  // reader is already looking at.
  const rateDifferences = reconciliation.rows
    .filter((row) => row.higherRate !== null && row.lowerRate !== null && !row.ratesAgree)
    .map((row) => {
      const delta = (row.lowerRate ?? 0) - (row.higherRate ?? 0);
      return (
        `${row.category}: ${money(row.higherRate!)}/hr on the higher estimate against ` +
        `${money(row.lowerRate!)}/hr on the comparison — a ${money(delta)}/hr ` +
        `${delta > 0 ? "increase" : "reduction"} applied across every hour in the category.`
      );
    });

  // Even-handedness is what makes the document credible: a report that only
  // ever finds against the carrier reads as advocacy. Where the comparison
  // allows MORE, the report says so in the same voice.
  const comparisonAllowsMore = reconciliation.rows
    .filter((row) => (row.costDifference ?? 0) > 0)
    .map((row) => {
      const hoursNote =
        row.hoursDifference !== null && row.hoursDifference > 0
          ? ` (${row.hoursDifference} hr more)`
          : "";
      return `${row.category}: ${money(row.costDifference!)} more${hoursNote} on the comparison estimate.`;
    });

  const balanceWarnings: string[] = [];
  const warn = (side: "higher" | "lower", check: ReconciliationCheck) => {
    const label = side === "higher" ? "higher-cost estimate" : "comparison estimate";
    if (check.subtotalDiscrepancy === null) {
      balanceWarnings.push(
        `The ${label}'s totals block could not be read completely, so its category rows were not reconciled against its own subtotal.`
      );
      return;
    }
    if (check.subtotalDiscrepancy !== 0) {
      balanceWarnings.push(
        `The ${label}'s category rows sum to ${money(check.subtotalDiscrepancy / 100)} ` +
          `${check.subtotalDiscrepancy > 0 ? "more" : "less"} than its own printed subtotal; ` +
          `figures for that document should be confirmed against the native file.`
      );
    }
    if (check.grandTotalDiscrepancy !== null && check.grandTotalDiscrepancy !== 0) {
      balanceWarnings.push(
        `The ${label}'s subtotal plus tax differs from its own printed grand total by ` +
          `${money(check.grandTotalDiscrepancy / 100)}.`
      );
    }
  };
  warn("higher", reconciliation.higherCheck);
  warn("lower", reconciliation.lowerCheck);

  return { gapStatement, rateDisputeStatement, rateDifferences, comparisonAllowsMore, balanceWarnings };
}
