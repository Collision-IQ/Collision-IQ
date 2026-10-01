/**
 * RO 22299 — 2026 Tesla Model 3, shop post-teardown (CCC ONE, $22,793.72)
 * against USAA SOR 1 (CCC ONE, $14,526.40). The Forensic Estimate Analysis
 * shipped; the Appraisal Dispute Report did not.
 *
 * D1 — the carrier's "152 # E.P.C. 1 3.50" (OTHER CHARGES) was dropped by the
 *      row re-parse: its description tokenized to single letters, every one
 *      fell to the length filter, and a row with no tokens is discarded. The
 *      carrier's line prices then summed $3.50 short of its printed
 *      Parts + Misc + Other Charges, and the strict line guard refused the
 *      report as an incomplete line read.
 * D2 — once produced, the report booked the shop's second user-defined labor
 *      category, "Bonded Or Welded Panel Replace 24.5 hrs @ $135.00", as
 *      parts money because its label matched no labor word: 10.9 h of labor
 *      gap instead of 35.4 h, and the parts bucket $3,307.50 too high. A
 *      line's category digit 2 was also read as the FIRST user category.
 *
 * The totals below are the two documents' printed ESTIMATE TOTALS blocks.
 * The original PDFs carry PII and are not in the repository.
 */
import { describe, expect, it } from "vitest";
import { parseCccEstimateRow, tokenizeDescription } from "../estimateDeltaMatcher";
import { estimateFromDeltaRows, totalsFromReconciliation } from "../appraisalSummary/estimateFromDeltaRows";
import { buildGapLedger } from "../appraisalSummary/gapLedger";
import type { ForensicReconciliation, ReconciliationRow } from "../forensicEstimateAnalysis";

describe("D1 — a dotted acronym is a description, not nothing", () => {
  it("tokenizes E.P.C. and L.E.D. as one word each", () => {
    expect(tokenizeDescription("E.P.C.")).toEqual(["epc"]);
    expect(tokenizeDescription("RT L.E.D. lamp")).toEqual(expect.arrayContaining(["led", "lamp"]));
    // Ordinary abbreviations with periods are untouched.
    expect(tokenizeDescription("Lt.Frt door")).toEqual(["lt", "front", "door"]);
  });

  it("keeps the carrier's OTHER CHARGES line and its price", () => {
    // The typed engine's serialization of the printed row.
    const row = parseCccEstimateRow("152 # E.P.C. 1 3.50 0.0 0.0", { section: "OTHER CHARGES" });
    expect(row).not.toBeNull();
    expect(row!.lineNumber).toBe(152);
    expect(row!.price).toBe(3.5);
    expect(row!.qty).toBe(1);
  });
});

function category(
  name: string,
  higher: [number | null, number | null, number | null],
  lower: [number | null, number | null, number | null]
): ReconciliationRow {
  const [higherHours, higherRate, higherCost] = higher;
  const [lowerHours, lowerRate, lowerCost] = lower;
  return {
    category: name,
    categoryKey: name.toUpperCase(),
    higherHours,
    higherRate,
    higherCost,
    lowerHours,
    lowerRate,
    lowerCost,
    costDifference: Math.round(((lowerCost ?? 0) - (higherCost ?? 0)) * 100) / 100,
    hoursDifference: null,
    ratesAgree: true,
    presentOnlyOn: higherCost === null ? "lower" : lowerCost === null ? "higher" : null,
  };
}

const clean = { categoriesSumToSubtotal: true, subtotalPlusTaxReachesGrandTotal: true, subtotalDiscrepancy: 0, grandTotalDiscrepancy: 0 };

// Shop (higher) and SOR 1 (lower), as printed.
const reconciliation: ForensicReconciliation = {
  rows: [
    category("Parts", [null, null, 3746.25], [null, null, 3745.53]),
    category("Body Labor", [46.9, 90, 4221], [69.9, 90, 6291]),
    category("Paint Labor", [35.3, 90, 3177], [25.6, 90, 2304]),
    category("Mechanical Labor", [10.2, 175, 1785], [3, 175, 525]),
    category("Aluminum Or Steel Repair", [17, 135, 2295], [null, null, null]),
    category("Bonded Or Welded Panel Replace", [24.5, 135, 3307.5], [null, null, null]),
    category("Paint Supplies", [35.3, 60, 2118], [null, null, 800]),
    category("Miscellaneous", [null, null, 853.76], [null, null, 35.4]),
    category("Other Charges", [null, null, null], [null, null, 3.5]),
  ],
  higherSubtotal: 21503.51,
  lowerSubtotal: 13704.43,
  higherTax: 1290.21,
  lowerTax: 821.97,
  higherGrandTotal: 22793.72,
  lowerGrandTotal: 14526.4,
  grandTotalDifference: -8267.32,
  higherDeductible: null,
  lowerDeductible: null,
  unmatchedTaxLanes: [],
  allSharedRatesAgree: true,
  higherCheck: clean,
  lowerCheck: clean,
  balances: true,
};

describe("D2 — every hours-at-rate category is labor", () => {
  const shop = totalsFromReconciliation(reconciliation, "higher");
  const carrier = totalsFromReconciliation(reconciliation, "lower");

  it("books Bonded Or Welded Panel Replace as structural labor, not parts money", () => {
    expect(shop.ok).toBe(true);
    if (!shop.ok) return;
    expect(shop.totals.labor.map((l) => [l.label, l.cat, l.hours])).toEqual([
      ["Body Labor", "body", 46.9],
      ["Paint Labor", "paint", 35.3],
      ["Mechanical Labor", "mechanical", 10.2],
      ["Aluminum Or Steel Repair", "aluminum", 17],
      ["Bonded Or Welded Panel Replace", "structural", 24.5],
    ]);
    expect(shop.totals.parts).toBe(3746.25);
    expect(shop.totals.misc).toBe(853.76);
    // Paint supplies print hours @ rate too, and stay materials.
    expect(shop.totals.paintSupplies).toEqual({ hours: 35.3, rate: 60, cost: 2118 });
    expect(shop.userCategories).toEqual(["aluminum", "structural"]);
  });

  it("closes the ledger with the whole hours gap in labor", () => {
    if (!shop.ok || !carrier.ok) throw new Error("totals did not read");
    const estimate = (role: "shop" | "carrier", read: typeof shop & { ok: true }) =>
      estimateFromDeltaRows({ role, fileName: role, rows: [], totals: read.totals, userCategory: read.userCategory, userCategories: read.userCategories, text: "" });
    const ledger = buildGapLedger(estimate("shop", shop), estimate("carrier", carrier), { strictLines: false });
    expect(ledger.gap).toBe(8267.32);
    expect(ledger.laborHours).toEqual({ shop: 133.9, carrier: 98.5, diff: 35.4, dollars: 5665.5 });
    expect(ledger.paintMaterials).toBe(1318);
    expect(ledger.nonLaborNet).toBe(815.58);
    expect(ledger.tax).toBe(468.24);
  });

  it("reads a line's category digit as the Nth user category in print order", () => {
    if (!shop.ok) throw new Error("totals did not read");
    const text = [
      "Line Oper Description Part Number Qty Extended Price $ Labor Paint",
      "5* Rpr RT Aperture panel 10.0 1 2.4",
      "12 Sect RT Outer panel cut in window opening 24.5 2",
      "SUBTOTALS",
    ].join("\n");
    const row = (lineNumber: number, description: string, labor: number, paint: number | null) => ({
      lineNumber,
      opCode: null,
      description,
      descriptionTokens: tokenizeDescription(description),
      partNumber: null,
      section: null,
      qty: null,
      price: null,
      labor,
      laborIncluded: false,
      paint,
      paintIncluded: false,
      laborType: null,
      partSource: [],
      rawText: "",
    });
    const estimate = estimateFromDeltaRows({
      role: "shop",
      fileName: "shop",
      rows: [row(5, "RT Aperture panel", 10, 2.4), row(12, "RT Outer panel cut in window opening", 24.5, null)],
      totals: shop.totals,
      userCategory: shop.userCategory,
      userCategories: shop.userCategories,
      text,
    });
    expect(estimate.lines.map((l) => [l.line, l.laborCat])).toEqual([
      [5, "aluminum"],
      [12, "structural"],
    ]);
  });
});
