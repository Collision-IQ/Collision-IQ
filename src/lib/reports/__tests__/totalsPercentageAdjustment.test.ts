/**
 * RO 22319 — 2023 Toyota Tacoma. Shop final (CCC ONE, $13,182.44) against the
 * carrier's Supplement of Record 3 ($8,283.96). The Forensic Estimate Analysis
 * shipped; the Appraisal Dispute Report did not, on every run.
 *
 * The carrier's ESTIMATE TOTALS block prints a percentage adjustment:
 *
 *   Parts Discount        $ 1,111.83   -5.0 %   -55.59
 *
 * Neither totals reader knew the row. The text reader matched no pattern; the
 * word reader took the "$" basis for a rate (1,111.83/hr) and "-5.0" for hours,
 * and the plausibility check dropped it. The SOR's categories then summed to
 * $7,870.65 against a printed subtotal of $7,815.06, the ledger could not
 * close, and the dispute report was refused — exactly $55.59 short.
 *
 * Fixture: the two totals blocks as printed (no names, claim number or VIN).
 */
import { describe, expect, it } from "vitest";
import { compareEstimateTotals, parseCccEstimateTotals } from "../estimateDeltaMatcher";
import { parseTotalsFromWords, type Word } from "../deltaEngine/rowCluster";
import { buildForensicReconciliation } from "../forensicEstimateAnalysis";
import { totalsFromReconciliation } from "../appraisalSummary/estimateFromDeltaRows";
import { buildGapLedger } from "../appraisalSummary/gapLedger";
import type { Estimate } from "../appraisalSummary/types";

const SHOP_TOTALS = `
ESTIMATE TOTALS
Category Basis Rate Cost $
Parts 2,277.04
Body Labor 63.1 hrs @ $ 75.00 /hr 4,732.50
Paint Labor 27.8 hrs @ $ 75.00 /hr 2,085.00
Paint Supplies 27.8 hrs @ $ 60.00 /hr 1,668.00
Miscellaneous 1,673.72
Subtotal 12,436.26
Sales Tax $ 12,436.26 @ 6.0000 % 746.18
Grand Total 13,182.44
`;

const CARRIER_TOTALS = `
ESTIMATE TOTALS
Category Basis Rate Cost $
Parts 2,043.20
Parts Discount $ 1,111.83 -5.0 % -55.59
Body Labor 56.0 hrs @ $ 61.00 /hr 3,416.00
Paint Labor 14.1 hrs @ $ 61.00 /hr 860.10
Paint Supplies 14.1 hrs @ $ 41.00 /hr 578.10
Miscellaneous 968.75
Other Charges 4.50
Subtotal 7,815.06
Sales Tax $ 7,815.06 @ 6.0000 % 468.90
Total Cost of Repairs 8,283.96
Deductible 500.00
Total Adjustments 500.00
Net Cost of Repairs 7,783.96
`;

/** One printed row as positioned words, left to right on one baseline. */
function wordRow(texts: string[], top: number): Word[] {
  return texts.map((text, index) => ({ text, x0: 100 + index * 60, x1: 150 + index * 60, top, bottom: top + 8 }));
}

const cents = (n: number) => Math.round(n * 100);

describe("totals-block percentage adjustments (RO 22319)", () => {
  it("text reader keeps the signed Parts Discount, never its basis", () => {
    const totals = parseCccEstimateTotals(CARRIER_TOTALS)!;
    const discount = totals.categories.find((c) => c.category === "Parts Discount");
    expect(discount).toEqual({ category: "Parts Discount", hours: null, rate: null, cost: -55.59 });
    const sum = totals.categories.reduce((s, c) => s + cents(c.cost ?? 0), 0);
    expect(sum).toBe(cents(7815.06));
  });

  it("text reader does not mistake Total Adjustments (the deductible) for a category", () => {
    const totals = parseCccEstimateTotals(CARRIER_TOTALS)!;
    expect(totals.categories.map((c) => c.category)).not.toContain("Total Adjustments");
    expect(totals.grandTotal).toBe(8283.96);
  });

  it("word reader keeps the row as amount-only instead of dropping it as an implausible rate", () => {
    const rows = [
      wordRow(["ESTIMATE", "TOTALS"], 100),
      wordRow(["Parts", "2,043.20"], 112),
      wordRow(["Parts", "Discount", "$", "1,111.83", "-5.0", "%", "-55.59"], 124),
      wordRow(["Body", "Labor", "56.0", "hrs", "@", "$", "61.00", "/hr", "3,416.00"], 136),
      wordRow(["Miscellaneous", "968.75"], 148),
      wordRow(["Subtotal", "7,815.06"], 160),
    ].flat();
    const parsed = parseTotalsFromWords(new Map([[1, rows]]));
    const discount = parsed.find((row) => row.category === "Parts Discount");
    expect(discount).toMatchObject({ hours: null, rate: null, amount: -55.59 });
    expect(parsed.find((row) => row.category === "Body Labor")).toMatchObject({ hours: 56, rate: 61, amount: 3416 });
  });

  it("the totals comparison reconciles: no reconciliation gap, discount stated as carrier-only", () => {
    const deltas = compareEstimateTotals({
      higher: parseCccEstimateTotals(SHOP_TOTALS),
      lower: parseCccEstimateTotals(CARRIER_TOTALS),
    });
    expect(deltas.map((d) => d.kind)).not.toContain("reconciliation_gap");
    expect(deltas.find((d) => d.category === "Parts Discount")?.kind).toBe("category_only_on_lower");
  });

  it("the Appraisal Dispute Report ledger closes to the printed gap with the discount on its own line", () => {
    const reconciliation = buildForensicReconciliation({
      higherTotals: parseCccEstimateTotals(SHOP_TOTALS),
      lowerTotals: parseCccEstimateTotals(CARRIER_TOTALS),
    });
    expect(reconciliation.lowerCheck.categoriesSumToSubtotal).toBe(true);
    const shopRead = totalsFromReconciliation(reconciliation, "higher");
    const carrierRead = totalsFromReconciliation(reconciliation, "lower");
    if (!shopRead.ok || !carrierRead.ok) throw new Error("totals did not read");
    // Kept out of parts/misc: no estimate line carries it, and those buckets
    // must be reproduced by line prices.
    expect(carrierRead.totals.parts).toBe(2043.2);
    expect(carrierRead.totals.totalsAdjustments).toEqual([{ label: "Parts Discount", cost: -55.59 }]);
    const estimate = (role: "shop" | "carrier", totals: Estimate["totals"]): Estimate => ({
      role,
      fileName: role,
      vehicle: "2023 TOYO Tacoma",
      totals,
      lines: [],
    });
    const ledger = buildGapLedger(estimate("shop", shopRead.totals), estimate("carrier", carrierRead.totals), {
      strictLines: false,
    });
    expect(ledger.gap).toBe(4898.48);
    expect(ledger.totalsAdjustments).toBe(55.59);
  });
});
