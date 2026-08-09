/**
 * The reconciliation is the spine of the forensic report: if it does not agree
 * with the documents it claims to reconcile, every finding built on it is
 * suspect. These tests pin two properties.
 *
 * 1. It BALANCES to the cent, and says so honestly when it does not. Float
 *    arithmetic on money drifts; a report that silently presents rows summing
 *    to $0.01 off its own printed subtotal is worse than one that flags it.
 * 2. It does not OVERCLAIM. "No rate dispute" is the single most useful
 *    sentence the report can carry, and the most damaging one to assert
 *    wrongly, so it may only appear when every shared rate actually matches.
 */
import { describe, it, expect } from "vitest";
import {
  buildForensicReconciliation,
  describeReconciliation,
} from "../forensicEstimateAnalysis";
import type { EstimateTotalsSummary } from "../estimateDeltaMatcher";

function totals(
  categories: Array<[string, number | null, number | null, number]>,
  opts: { tax?: number; taxLanes?: Array<{ label: string; amount: number }> } = {}
): EstimateTotalsSummary {
  const subtotal = categories.reduce((sum, [, , , cost]) => sum + cost, 0);
  const tax = opts.tax ?? 0;
  return {
    categories: categories.map(([category, hours, rate, cost]) => ({ category, hours, rate, cost })),
    subtotal: Math.round(subtotal * 100) / 100,
    salesTax: tax,
    grandTotal: Math.round((subtotal + tax) * 100) / 100,
    taxLanes: opts.taxLanes ?? (tax ? [{ label: "Sales Tax", amount: tax }] : []),
  };
}

describe("the reconciliation balances against the documents' own totals", () => {
  it("reconciles both documents and reports the headline gap", () => {
    const result = buildForensicReconciliation({
      higherTotals: totals(
        [["Body Labor", 78.9, 61, 4812.9], ["Parts", null, null, 13217.14]],
        { tax: 1081.8 }
      ),
      lowerTotals: totals(
        [["Body Labor", 50.6, 61, 3152.6], ["Parts", null, null, 7538.9]],
        { tax: 641.49 }
      ),
    });
    expect(result.balances).toBe(true);
    // 10691.5 + 641.49 = 11332.99 against 18030.04 + 1081.8 = 19111.84
    expect(result.grandTotalDifference).toBeCloseTo(-7778.85, 2);
    expect(describeReconciliation(result).balanceWarnings).toEqual([]);
  });

  it("survives the float sums that make money arithmetic drift", () => {
    // 0.1 + 0.2 !== 0.3 in IEEE754. A naive equality check fails this document
    // even though it is perfectly consistent.
    const drifting = totals([
      ["Body Labor", 1, 0.1, 0.1],
      ["Refinish", 1, 0.2, 0.2],
    ]);
    const result = buildForensicReconciliation({ higherTotals: drifting, lowerTotals: drifting });
    expect(result.higherCheck.categoriesSumToSubtotal).toBe(true);
    expect(result.balances).toBe(true);
  });

  it("FLAGS a document whose rows do not sum to its own subtotal", () => {
    const inconsistent: EstimateTotalsSummary = {
      categories: [{ category: "Parts", hours: null, rate: null, cost: 100 }],
      subtotal: 150, // the document's own printed subtotal disagrees
      salesTax: 0,
      grandTotal: 150,
      taxLanes: [],
    };
    const result = buildForensicReconciliation({
      higherTotals: inconsistent,
      lowerTotals: totals([["Parts", null, null, 90]]),
    });
    expect(result.balances).toBe(false);
    expect(result.higherCheck.subtotalDiscrepancy).toBe(-5000); // cents
    expect(describeReconciliation(result).balanceWarnings.join(" ")).toMatch(
      /category rows sum to \$50\.00 less than its own printed subtotal/
    );
  });

  it("does not silently reconcile a document it could not read", () => {
    const result = buildForensicReconciliation({
      higherTotals: totals([["Parts", null, null, 100]]),
      lowerTotals: null,
    });
    expect(result.balances).toBe(false);
    expect(describeReconciliation(result).balanceWarnings.join(" ")).toMatch(
      /comparison estimate's totals block could not be read completely/
    );
  });
});

describe("the reconciliation pairs categories by concept, not by string", () => {
  it("pairs a glued label with its spaced counterpart", () => {
    // Glued text layers print "MechanicalLabor"; an exact-string lookup reads
    // that as a category the other document is missing.
    const result = buildForensicReconciliation({
      higherTotals: totals([["MechanicalLabor", 19.4, 100, 1940]]),
      lowerTotals: totals([["Mechanical Labor", 16, 100, 1600]]),
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].presentOnlyOn).toBeNull();
    expect(result.rows[0].costDifference).toBeCloseTo(-340, 2);
    expect(result.rows[0].hoursDifference).toBeCloseTo(-3.4, 1);
  });

  it("marks a category only one document carries", () => {
    const result = buildForensicReconciliation({
      higherTotals: totals([["Parts", null, null, 100]]),
      lowerTotals: totals([["Parts", null, null, 90], ["Glass Labor", 2.6, 61, 158.6]]),
    });
    const glass = result.rows.find((row) => /glass/i.test(row.category));
    expect(glass?.presentOnlyOn).toBe("lower");
    expect(glass?.costDifference).toBeNull(); // no counterpart to difference against
  });

  it("surfaces a tax lane one document charges and the other does not", () => {
    const result = buildForensicReconciliation({
      higherTotals: totals([["Parts", null, null, 100]], {
        tax: 6,
        taxLanes: [{ label: "Sales Tax", amount: 6 }],
      }),
      lowerTotals: totals([["Parts", null, null, 100]], {
        tax: 8,
        taxLanes: [{ label: "Sales Tax", amount: 6 }, { label: "County Tax", amount: 2 }],
      }),
    });
    expect(result.unmatchedTaxLanes).toEqual([
      { label: "County Tax", amount: 2, onlyOn: "lower" },
    ]);
  });
});

describe("'no rate dispute' is asserted only when it is true", () => {
  it("states it when every shared rate matches to the cent", () => {
    const result = buildForensicReconciliation({
      higherTotals: totals([["Body Labor", 78.9, 61, 4812.9], ["Refinish", 42.1, 61, 2568.1]]),
      lowerTotals: totals([["Body Labor", 50.6, 61, 3152.6], ["Refinish", 17.8, 61, 1085.8]]),
    });
    expect(result.allSharedRatesAgree).toBe(true);
    expect(describeReconciliation(result).rateDisputeStatement).toMatch(/raises no rate dispute/);
  });

  it("stays SILENT when a rate differs, rather than mischaracterising it", () => {
    const result = buildForensicReconciliation({
      higherTotals: totals([["Body Labor", 78.9, 61, 4812.9]]),
      lowerTotals: totals([["Body Labor", 50.6, 55, 2783]]),
    });
    expect(result.allSharedRatesAgree).toBe(false);
    expect(describeReconciliation(result).rateDisputeStatement).toBeNull();
  });

  it("does not claim rate agreement from a document with no shared rates at all", () => {
    // Parts rows carry no rate. Vacuous truth would let "every rate matches"
    // through on a pair that never printed a comparable rate.
    const result = buildForensicReconciliation({
      higherTotals: totals([["Parts", null, null, 100]]),
      lowerTotals: totals([["Parts", null, null, 90]]),
    });
    expect(result.allSharedRatesAgree).toBe(false);
    expect(describeReconciliation(result).rateDisputeStatement).toBeNull();
  });
});

describe("rate differences and credits are surfaced, not buried", () => {
  const mixed = () =>
    buildForensicReconciliation({
      higherTotals: totals([
        ["Mechanical Labor", 9.3, 175, 1627.5],
        ["Body Labor", 52.7, 90, 4743],
      ]),
      lowerTotals: totals([
        ["Mechanical Labor", 9.6, 110, 1056],
        ["Body Labor", 71.5, 95, 6792.5],
      ]),
    });

  it("names each category whose rate differs, with both rates", () => {
    // RO 22059: mechanical labour is $175/hr against $110/hr. A rate gap applies
    // across every hour in the category, so it must not sit as one finding among
    // dozens on page five.
    const { rateDifferences } = describeReconciliation(mixed());
    expect(rateDifferences.join(" ")).toMatch(
      /Mechanical Labor: \$175\.00\/hr on the higher estimate against \$110\.00\/hr on the comparison/
    );
    // money() prints the magnitude; the word "reduction" carries the direction.
    expect(rateDifferences.join(" ")).toMatch(/\$65\.00\/hr reduction/);
    expect(rateDifferences.join(" ")).toMatch(/Body Labor.*\$5\.00\/hr increase/);
  });

  it("states where the COMPARISON allows more — a report that only ever finds one way is advocacy", () => {
    const { comparisonAllowsMore } = describeReconciliation(mixed());
    expect(comparisonAllowsMore.join(" ")).toMatch(
      /Body Labor: \$2,049\.50 more \(18\.8 hr more\) on the comparison estimate/
    );
    // Mechanical is lower on the comparison, so it is not a credit.
    expect(comparisonAllowsMore.join(" ")).not.toMatch(/Mechanical/);
  });

  it("says nothing about rates when they all agree beyond the no-dispute statement", () => {
    const agreeing = buildForensicReconciliation({
      higherTotals: totals([["Body Labor", 78.9, 61, 4812.9]]),
      lowerTotals: totals([["Body Labor", 50.6, 61, 3086.6]]),
    });
    const described = describeReconciliation(agreeing);
    expect(described.rateDifferences).toEqual([]);
    expect(described.rateDisputeStatement).toMatch(/raises no rate dispute/);
  });
});
