/**
 * Adapter: the Forensic report's input → PlainSummaryInput.
 *
 * This is the only wiring point between the Delta pipeline and the
 * Plain-Language Dispute Summary. It reads the SAME objects the Forensic
 * Estimate Analysis is rendered from — the Section 4 reconciliation (both
 * documents' printed totals), the numbered findings, the no-counterpart rows
 * that make up Appendix A — and maps them onto the summary's narrow contract.
 * It adds no facts: a figure the reconciliation could not read arrives here as
 * null and leaves as "not shown", never as zero.
 */
import type { CitationDensityFinding } from "@/lib/ai/types/estimateScrubber";
import type { ForensicReconciliation, ReconciliationRow } from "./forensicEstimateAnalysis";
import { shortOperationName } from "./deltaForensicReport";
import { forensicDomainOf } from "./forensicReportRenderer";
import type { DeltaCategory, EstimateTotals, Finding, FindingSection, LaborCategory, PlainSummaryInput } from "./plainLanguageSummary";

export type PlainSummaryAdapterInput = {
  reconciliation: ForensicReconciliation;
  findings: CitationDensityFinding[];
  /** Badge number per finding id, as drawn on the annotated estimate. */
  findingNumbers?: Map<string, number>;
  higherDocumentName: string;
  lowerDocumentName: string;
  /** Optional author label for the comparison document (the carrier's name). */
  lowerDocumentLabel?: string | null;
  higherLineCount: number | null;
  lowerLineCount: number | null;
  noCounterpartRows: Array<{ line: number | null; description: string; amount: number | null }>;
  vehicleLabel: string | null;
  roNumber?: string | null;
  identity?: Array<{ label: string; value: string }>;
  generatedAt: string;
  /** The run's export redaction policy; applied to names and finding titles. */
  scrub?: (value: string) => string;
};

export type PlainSummaryAdapterResult =
  | { ok: true; input: PlainSummaryInput }
  | { ok: false; reason: string };

// Concept keys the reconciliation pairs categories under (deltaEngine's
// canonTotalsCategory): PARTS, BODY, PAINT, PAINTSUPPLIES, MISCELLANEOUS.
const BUCKET_KEYS = new Set(["PARTS", "BODY", "PAINT", "PAINTSUPPLIES", "MISCELLANEOUS"]);

const CATEGORY_BY_ID: Array<[RegExp, DeltaCategory]> = [
  [/totals-lower-only-lines/, "lower_only_lines"],
  [/totals-rate-difference/, "rate_difference"],
  [/totals-total-difference/, "total_difference"],
  [/totals-(?:category-amount-difference|category-missing-on-lower|category-only-on-lower|hours-difference)/, "category_amount"],
  [/sand_polish_p_page_support|p-page-review|p_page_review/, "support_review"],
  [/delta-reduced-labor/, "reduced_labor"],
  [/delta-part-(?:price|source)/, "part_or_price_difference"],
  [/delta-missing-operation(?!-ocr-uncertain)/, "missing_operation"],
];

function categoryOf(finding: CitationDensityFinding): DeltaCategory | null {
  const id = finding.id ?? "";
  for (const [pattern, category] of CATEGORY_BY_ID) {
    if (pattern.test(id)) return category;
  }
  // Findings the detectors did not type by id fall back to the gap type they
  // carry — but only the two gap types whose meaning the summary knows.
  if (finding.deltaClass === "PRESENT_ONLY_IN_SOURCE") return "missing_operation";
  if (finding.deltaClass === "VALUE_CHANGED" || finding.deltaClass === "PART_SWAPPED") return "part_or_price_difference";
  if (finding.deltaClass === "LABOR_CHANGED") return "reduced_labor";
  if (finding.deltaClass) return null;
  if (finding.estimateGapType === "missing_from_carrier") return "missing_operation";
  if (finding.estimateGapType === "reduced_by_carrier") return "reduced_labor";
  return null;
}

function sectionOf(finding: CitationDensityFinding): FindingSection {
  const domain = forensicDomainOf(finding);
  return domain === "structural" || domain === "adas" || domain === "refinish" ? domain : "other";
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const numberOr = (value: unknown): number | undefined => (isNumber(value) ? value : undefined);
const lineNumberOf = (value: string | null | undefined): number | undefined => {
  const match = String(value ?? "").match(/\d+/);
  return match ? Number(match[0]) : undefined;
};

/**
 * The paint-hour difference a line-item finding carries. The finding object
 * records the labor-hour delta in `impact.laborHoursImpact`; the paint delta
 * travels only in the support summary the delta pass wrote ("Paint delta: 3.6
 * hours."), so it is read back from there. "not quantified" reads as absent.
 */
function paintDeltaOf(finding: CitationDensityFinding): number | undefined {
  const match = (finding.currentSupportSummary ?? "").match(/Paint delta:\s*([+-]?\d+(?:\.\d+)?)\s*hours/i);
  return match ? Number(match[1]) : undefined;
}

/**
 * The comparison document's price on a matched line. The delta pass records
 * the annotated line's price in the evidence and the price difference
 * (higher minus lower) in `impact.dollarImpact`, so the comparison price is
 * the difference of the two — arithmetic on the pipeline's own figures, not
 * a read of the raw row text.
 */
function comparisonPriceOf(priceA: number | undefined, dollarDelta: number | undefined): number | undefined {
  if (priceA === undefined || dollarDelta === undefined) return undefined;
  return Math.round((priceA - dollarDelta) * 100) / 100;
}

/** "Lines only on the lower estimate (47)" → 47. */
function lowerOnlyCountOf(finding: CitationDensityFinding): number | undefined {
  const match = finding.operationLabel.match(/\((\d+)\)\s*$/);
  return match ? Number(match[1]) : undefined;
}

/** The first few lower-only lines the delta pass listed, as written. */
function lowerOnlySamplesOf(finding: CitationDensityFinding, scrub: (value: string) => string): string[] {
  const summary = finding.currentSupportSummary ?? "";
  const marker = "no counterpart on this estimate: ";
  const start = summary.indexOf(marker);
  if (start < 0) return [];
  let listed = summary.slice(start + marker.length);
  const more = listed.search(/\s(?:…|\.\.\.)and \d+ more/);
  if (more >= 0) listed = listed.slice(0, more);
  const additionally = listed.indexOf(" Additionally, ");
  if (additionally >= 0) listed = listed.slice(0, additionally);
  return listed
    .split("; ")
    .map((item) => scrub(item.replace(/\.\s*$/, "").trim()))
    .filter(Boolean)
    .slice(0, 4);
}

function laborCategory(hours: number | null, rate: number | null, cost: number | null): LaborCategory | null {
  return cost === null ? null : { hours, rate, total: cost };
}

/**
 * Both documents' bucket totals from the reconciliation rows. A category one
 * document does not print is a zero on that document ONLY when the
 * reconciliation itself accepted the absence (costDifference non-null, i.e.
 * that document's categories reconcile to its own subtotal); otherwise the
 * figure is unknown and the bucket says so.
 */
function totalsOf(
  reconciliation: ForensicReconciliation,
  side: "higher" | "lower"
): { totals: EstimateTotals; unpriced: string[] } | null {
  const grandTotal = side === "higher" ? reconciliation.higherGrandTotal : reconciliation.lowerGrandTotal;
  if (grandTotal === null) return null;
  const rows = new Map<string, ReconciliationRow>();
  for (const row of reconciliation.rows) rows.set(row.categoryKey, row);
  const unpriced: string[] = [];

  const cost = (row: ReconciliationRow | undefined): number | null => {
    if (!row) return null;
    const own = side === "higher" ? row.higherCost : row.lowerCost;
    if (own !== null) return own;
    // Absent on this side. Zero only when the engine reconciled it as zero.
    if (row.costDifference !== null) return 0;
    unpriced.push(row.category);
    return null;
  };
  const hours = (row: ReconciliationRow | undefined) => (row ? (side === "higher" ? row.higherHours : row.lowerHours) : null);
  const rate = (row: ReconciliationRow | undefined) => (row ? (side === "higher" ? row.higherRate : row.lowerRate) : null);

  const parts = rows.get("PARTS");
  const body = rows.get("BODY");
  const paint = rows.get("PAINT");
  const supplies = rows.get("PAINTSUPPLIES");
  const misc = rows.get("MISCELLANEOUS");

  const otherRows = reconciliation.rows.filter((row) => !BUCKET_KEYS.has(row.categoryKey));
  let other: EstimateTotals["other"] = null;
  if (otherRows.length) {
    let sum = 0;
    let known = false;
    for (const row of otherRows) {
      const value = cost(row);
      if (value === null) continue;
      known = true;
      sum += value;
    }
    other = known ? { label: `Other categories (${otherRows.map((row) => row.category).join(", ")})`, total: Math.round(sum * 100) / 100 } : null;
  }

  return {
    totals: {
      parts: cost(parts),
      bodyLabor: laborCategory(hours(body), rate(body), cost(body)),
      paintLabor: laborCategory(hours(paint), rate(paint), cost(paint)),
      paintSupplies: laborCategory(hours(supplies), rate(supplies), cost(supplies)),
      miscellaneous: cost(misc),
      other,
      subtotal: side === "higher" ? reconciliation.higherSubtotal : reconciliation.lowerSubtotal,
      tax: side === "higher" ? reconciliation.higherTax : reconciliation.lowerTax,
      total: grandTotal,
    },
    unpriced,
  };
}

export function adaptForensicToPlainSummary(input: PlainSummaryAdapterInput): PlainSummaryAdapterResult {
  const scrub = input.scrub ?? ((value: string) => value);
  const higher = totalsOf(input.reconciliation, "higher");
  const lower = totalsOf(input.reconciliation, "lower");
  if (!higher || !lower) {
    return { ok: false, reason: "one of the two estimates' grand totals could not be read from its totals block" };
  }
  if (higher.totals.total <= lower.totals.total) {
    return { ok: false, reason: "the annotated estimate is not the higher of the two, so there is no shop-side gap to explain" };
  }

  const findings: Finding[] = [];
  input.findings.forEach((finding, index) => {
    const category = categoryOf(finding);
    if (!category) return;
    const evidence = finding.shopEvidence ?? finding.carrierEvidence;
    const priceA = numberOr(evidence?.amount);
    const dollar = numberOr(finding.impact?.dollarImpact);
    findings.push({
      // The badge number the annotated estimate drew. When a badge map is
      // supplied and this finding has no badge, it stays unnumbered (0) rather
      // than being given a number the reader cannot find on the estimate.
      id: input.findingNumbers ? input.findingNumbers.get(finding.id) ?? 0 : index + 1,
      category,
      section: sectionOf(finding),
      title: scrub(shortOperationName(finding.operationLabel)),
      lineA: lineNumberOf(evidence?.lineNumber),
      amountDelta: dollar,
      laborDelta: numberOr(finding.impact?.laborHoursImpact),
      paintDelta: paintDeltaOf(finding),
      priceA,
      priceB: category === "part_or_price_difference" ? comparisonPriceOf(priceA, dollar) : undefined,
      lowerOnlyCount: category === "lower_only_lines" ? lowerOnlyCountOf(finding) : undefined,
      lowerOnlySamples: category === "lower_only_lines" ? lowerOnlySamplesOf(finding, scrub) : undefined,
    });
  });

  const identity = input.identity ?? [];
  const roNumber =
    input.roNumber?.trim() || identity.find((row) => /^ro number$/i.test(row.label))?.value?.trim() || undefined;
  const vehicle =
    identity.find((row) => /^vehicle$/i.test(row.label))?.value?.trim() ||
    (input.vehicleLabel?.trim() ? scrub(input.vehicleLabel.trim()) : "Vehicle not identified on the documents");

  return {
    ok: true,
    input: {
      preparedDate: input.generatedAt.slice(0, 10),
      vehicle,
      roNumber,
      docA: { title: scrub(input.higherDocumentName), lineCount: input.higherLineCount, totals: higher.totals },
      docB: {
        title: scrub(input.lowerDocumentName),
        label: input.lowerDocumentLabel ? scrub(input.lowerDocumentLabel) : undefined,
        lineCount: input.lowerLineCount,
        totals: lower.totals,
      },
      findings,
      missingLineCount: input.noCounterpartRows.length,
      unpricedCategories: [...new Set([...higher.unpriced, ...lower.unpriced])],
      identity,
    },
  };
}
