/**
 * RO 22335 — 2021 Volvo XC60 T8, shop post-teardown (CCC ONE, $13,309.34)
 * against SOR 2 (CCC ONE, $6,758.85). The Forensic Estimate Analysis shipped;
 * the Appraisal Dispute Report did not, for two reasons in turn:
 *
 * D1 — the SOR prints "Body Supplies 10.1 hrs @ $3.00 = $30.30" in its totals
 *      block. It is priced from hours like paint supplies and no line carries
 *      it, but it was booked in misc, so the strict line guard found the
 *      carrier's lines $30.30 short and refused the report.
 * D2 — the SOR lists its pre/post scans as "Subl … 1 m": present, unpriced,
 *      "invoices considered upon completion". The item text printed
 *      "theirs $0.00 for the same sublet", which the wording gate refuses.
 *
 * And two wording errors the produced report then showed:
 * D3 — the owner note said "Most of that difference (10%) is labor time".
 * D4 — an equal-hours group $764.45 apart was explained as labor coding when
 *      the difference was priced lines.
 *
 * Totals are the documents' printed ESTIMATE TOTALS blocks; lines are a
 * minimal subset (the PDFs carry PII and are not in the repository) whose
 * prices reproduce the carrier's printed non-labor total, so the strict line
 * guard runs as it does in production.
 */
import { describe, expect, it } from "vitest";
import { totalsFromReconciliation } from "../appraisalSummary/estimateFromDeltaRows";
import { buildGapLedger } from "../appraisalSummary/gapLedger";
import { nonLaborBuckets } from "../appraisalSummary/nonLaborBuckets";
import type { Estimate, EstimateLine } from "../appraisalSummary/types";
import type { ForensicReconciliation, ReconciliationRow } from "../forensicEstimateAnalysis";
import {
  buildOwnerNote,
  buildPlainSummaryDocument,
  buildPlainSummaryModel,
  plainSummaryDocumentText,
  renderPlainSummaryPdf,
} from "../plainLanguageSummary";

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
    ratesAgree: higherRate === lowerRate,
    presentOnlyOn: higherCost === null ? "lower" : lowerCost === null ? "higher" : null,
  };
}

const clean = { categoriesSumToSubtotal: true, subtotalPlusTaxReachesGrandTotal: true, subtotalDiscrepancy: 0, grandTotalDiscrepancy: 0 };

const reconciliation: ForensicReconciliation = {
  rows: [
    category("Parts", [null, null, 3704.22], [null, null, 2340.26]),
    category("Body Labor", [41.2, 75, 3090], [35.1, 62, 2176.2]),
    category("Paint Labor", [21.6, 75, 1620], [13.9, 62, 861.8]),
    category("Paint Supplies", [21.6, 60, 1296], [13.9, 42, 583.8]),
    category("Miscellaneous", [null, null, 2906.44], [null, null, 1.5]),
    category("Mechanical Labor", [null, null, null], [4.5, 85, 382.5]),
    category("Body Supplies", [null, null, null], [10.1, 3, 30.3]),
  ],
  higherSubtotal: 12616.66,
  lowerSubtotal: 6376.36,
  higherTax: 692.68,
  lowerTax: 382.49,
  higherGrandTotal: 13309.34,
  lowerGrandTotal: 6758.85,
  grandTotalDifference: -6550.49,
  higherDeductible: null,
  lowerDeductible: null,
  unmatchedTaxLanes: [],
  allSharedRatesAgree: false,
  higherCheck: clean,
  lowerCheck: clean,
  balances: true,
};

const shopRead = totalsFromReconciliation(reconciliation, "higher");
const carrierRead = totalsFromReconciliation(reconciliation, "lower");
if (!shopRead.ok || !carrierRead.ok) throw new Error("totals did not read");

const line = (l: Partial<EstimateLine> & { line: number; desc: string }): EstimateLine => ({ manual: false, partSource: [], ...l });

const shop: Estimate = {
  role: "shop",
  fileName: "Shop Post-TD 22335.pdf",
  vehicle: "2021 VOLV XC60 T8 Recharge R-Design eAWD",
  totals: shopRead.totals,
  lines: [
    line({ line: 52, oper: "Repl", desc: "LT Door shell (HSS)", partNumber: "3239908", qty: 1, price: 3704.22, hours: 6.9, laborCat: "body" }),
    line({ line: 90, oper: "Subl", desc: "Calibrate front camera", qty: 1, price: 726.95, hours: 0.5, laborCat: "mechanical" }),
    line({ line: 96, oper: "Subl", desc: "Pre-repair scan", qty: 1, price: 201 }),
    line({ line: 104, oper: "Subl", desc: "Post-repair scan", qty: 1, price: 201 }),
    line({ line: 110, desc: "Hazardous waste disposal", qty: 1, price: 1777.49 }),
  ],
  altPartsUsage: { aftermarket: 0, optionalOem: 0, reconditioned: 0, recycled: 0 },
};

const carrier: Estimate = {
  role: "carrier",
  fileName: "SOR-2 22335.pdf",
  vehicle: shop.vehicle,
  totals: carrierRead.totals,
  lines: [
    line({ line: 20, oper: "Repl", desc: "LT Door shell (HSS)", partNumber: "3239908", qty: 1, price: 2340.26, hours: 5.0, laborCat: "body" }),
    line({ line: 71, oper: "Subl", desc: "Pre-repair scan", qty: 1, note: "Invoices with printed scan results considered upon completion of operation." }),
    line({ line: 72, oper: "Subl", desc: "Other calibration operation", qty: 1 }),
    line({ line: 74, oper: "Subl", desc: "Post-repair scan", qty: 1 }),
    line({ line: 75, oper: "Rpr", desc: "Calibration drive", hours: 0.5, laborCat: "mechanical" }),
    line({ line: 80, desc: "Hazardous waste", qty: 1, price: 1.5 }),
  ],
  altPartsUsage: { aftermarket: 0, optionalOem: 0, reconditioned: 0, recycled: 0 },
};

describe("D1 — hours-priced supplies are materials, not unread lines", () => {
  it("books Body Supplies outside misc", () => {
    expect(carrierRead.totals.otherMaterials).toEqual([{ label: "Body Supplies", hours: 10.1, rate: 3, cost: 30.3 }]);
    expect(carrierRead.totals.misc).toBe(1.5);
    expect(shopRead.totals.otherMaterials).toBeUndefined();
  });

  it("the carrier's lines reproduce its printed non-labor total under the strict guard", () => {
    expect(() => nonLaborBuckets(carrier, { strict: true })).not.toThrow();
  });

  it("closes the ledger to the printed difference, with Other materials as its own bucket", () => {
    const ledger = buildGapLedger(shop, carrier);
    expect(ledger.gap).toBe(6550.49);
    expect(ledger.laborHours).toEqual({ shop: 62.8, carrier: 53.5, diff: 9.3, dollars: 652.5 });
    expect(ledger.laborRate).toBe(637);
    expect(ledger.paintMaterials).toBe(712.2);
    expect(ledger.otherMaterials).toBe(-30.3);
    expect(ledger.nonLaborNet).toBe(4268.9);
    expect(ledger.tax).toBe(310.19);
  });
});

describe("the Appraisal Dispute Report is produced and reads truthfully", () => {
  const model = buildPlainSummaryModel({ preparedDate: "2026-10-01", vehicle: shop.vehicle, roNumber: "22335", shop, carrier, pairs: [] });
  const text = plainSummaryDocumentText(buildPlainSummaryDocument(model));

  it("renders past the wording gate", async () => {
    const rendered = await renderPlainSummaryPdf(model);
    expect(rendered.pageCount).toBeGreaterThan(0);
  });

  it("D1 — prints Other materials with the printed category", () => {
    expect(text).toMatch(/Other materials\s+-\$30\.30\s+\$0\.00 . Body Supplies \$30\.30\./);
  });

  it("D2 — an unpriced carrier sublet is open for invoice, never $0.00", () => {
    expect(text).toMatch(/theirs lists the same sublet with no price \(L71, L74\), left open for invoice/);
    expect(text).not.toMatch(/theirs \$0\.00 for the same sublet/);
  });

  it("D3 — the owner note never calls 10% 'most'", () => {
    const note = buildOwnerNote(model);
    expect(note).toMatch(/Labor time accounts for 10% of that difference/);
    expect(note).not.toMatch(/Most of that difference/);
  });

  it("D4 — equal hours a dollar gap apart name the priced lines", () => {
    expect(text).toMatch(/Ours 0\.5 hr, theirs 0\.5 hr: the same hours\. The difference is in the priced lines: ours \$726\.95, theirs none priced\./);
  });
});
