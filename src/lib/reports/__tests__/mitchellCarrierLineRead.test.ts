/**
 * A Mitchell carrier's line read is held to its print as the print books it.
 *
 * Measured 2 Oct 2026: with a Mitchell carrier estimate as the comparison, the
 * line prices reaching the Appraisal Dispute Report adapter did not reproduce
 * the printed Parts + Misc ($8,515.33 against $7,297.69 on F-RK2, $7,626.89
 * against $6,598.49 on RO 21011, $3,540.26 against $3,215.26 on RO 22132), so
 * the strict line guard threw NonLaborParseError and no report was produced
 * for a Mitchell carrier. The line hours of the same prints close exactly; the
 * gap was booking, and the rekey sheet already knew it (rekey/rekeyLedger.ts):
 *
 *   - each labor category prints hours × rate plus a "Sublet / Add'l" amount,
 *     which is the dollars of priced rows that bill it (scans, cover car);
 *   - "Parts Adjustments" is a markup on the taxed sublet parts, on no line;
 *   - the computed paint materials are printed as a line as well as a total.
 *
 * The pair is the repository's own: the RO 22084 CCC shop estimate (word
 * layer and text) against each Mitchell text with no comparison word layer,
 * through the findings pass the pipeline runs.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildPdfTextLines, buildEstimateRowAnchorsFromLines, type PdfWord } from "../citationDensityRowAnchors";
import { buildRequiredEstimatorDeltaFindings } from "../annotatedCitationDensityEstimate";
import { detectEstimatePlatform, type EstimatePlatform } from "../estimatePlatform";
import type { ForensicReconciliation, ReconciliationRow } from "../forensicEstimateAnalysis";
import { estimateFromDeltaRows, totalsFromReconciliation } from "../appraisalSummary/estimateFromDeltaRows";
import { buildGapLedger } from "../appraisalSummary/gapLedger";
import { lineReconciliation, nonLaborBuckets, NonLaborParseError } from "../appraisalSummary/nonLaborBuckets";
import { buildShortPayView } from "../appraisalSummary/shortPayView";
import { round2, type Estimate } from "../appraisalSummary/types";
import { adaptForensicToPlainSummary } from "../plainLanguageSummaryAdapter";
import { buildPlainSummaryDocument, buildPlainSummaryModel, plainSummaryDocumentText, renderPlainSummaryPdf } from "../plainLanguageSummary";

const FIXTURES = path.join(__dirname, "../../../../tests/fixtures");
const read = (name: string) => fs.readFileSync(path.join(FIXTURES, name), "utf8");
const shopText = read("22084/shop_text.txt");
const shopWords = JSON.parse(read("22084/shop_words.json")) as PdfWord[];

type Forensic = NonNullable<ReturnType<typeof buildRequiredEstimatorDeltaFindings>["forensic"]>;

function runPair(carrierText: string): Forensic {
  const visualLines = buildPdfTextLines(shopWords);
  const anchors = buildEstimateRowAnchorsFromLines(visualLines, { sourceDocumentRole: "shop", sourceDocumentId: "shop-22084" });
  const generated = buildRequiredEstimatorDeltaFindings({
    anchors,
    visualLines,
    sourcePdfName: "Shop 22084.pdf",
    sourceDocumentId: "shop-22084",
    sourceDocumentRole: "shop",
    sourcePdfHash: "fixture-22084-shop",
    uploadedFileNames: ["Shop 22084.pdf", "Carrier Mitchell.pdf"],
    sourceText: shopText,
    comparisonEstimateTexts: [{ sourceDocumentId: "carrier", fileName: "Carrier Mitchell.pdf", text: carrierText, estimateRole: "carrier" }],
    extractionWarnings: [],
  });
  return generated.forensic!;
}

/** The carrier Estimate the adapter builds, booked for `platform`; `text` "" reads no Mitchell line. */
function carrierEstimate(forensic: Forensic, text: string, platform: EstimatePlatform | null): Estimate {
  const totals = totalsFromReconciliation(forensic.reconciliation, "lower", platform);
  if (!totals.ok) throw new Error(totals.reason);
  return estimateFromDeltaRows({
    role: "carrier",
    fileName: "Carrier Mitchell.pdf",
    rows: forensic.rows!.lower,
    totals: totals.totals,
    userCategory: totals.userCategory,
    userCategories: totals.userCategories,
    text,
  });
}

const price = (estimate: Estimate, ...lines: number[]) =>
  round2(lines.reduce((sum, n) => sum + (estimate.lines.find((l) => l.line === n)?.price ?? 0), 0));

/** Every category the totals hold, which the ledger requires to reach the printed subtotal. */
const booked = (e: Estimate) =>
  round2(e.totals.parts + e.totals.misc + e.totals.labor.reduce((s, l) => s + l.cost, 0) + e.totals.paintSupplies.cost);

function pair(file: string) {
  const text = read(file);
  const state = {} as { forensic: Forensic; asCcc: Estimate; asMitchell: Estimate };
  beforeAll(() => {
    expect(detectEstimatePlatform(text)).toBe("mitchell");
    state.forensic = runPair(text);
    state.asCcc = carrierEstimate(state.forensic, "", null);
    state.asMitchell = carrierEstimate(state.forensic, text, "mitchell");
  }, 60_000);
  return { text, state };
}

describe("F-RK2 (Lexus, Mitchell print with a CEG column)", () => {
  const { text, state } = pair("frk2-mitchell-text.txt");

  it("booked as a CCC print books it, reproduces the measured finding", () => {
    expect(lineReconciliation(state.asCcc)).toEqual({ lineTotal: 8515.33, printed: 7297.69, residual: -1217.64, closes: false });
    expect(() => nonLaborBuckets(state.asCcc, { strict: true })).toThrow(NonLaborParseError);
  });

  it("booked as the Mitchell print books it, the line read closes to the cent", () => {
    expect(lineReconciliation(state.asMitchell)).toEqual({ lineTotal: 7603.33, printed: 7603.33, residual: 0, closes: true });
    expect(() => nonLaborBuckets(state.asMitchell, { strict: true })).not.toThrow();
  });

  it("labor is hours × rate; each category's Sublet / Add'l is the priced rows that bill it", () => {
    const { totals } = state.asMitchell;
    expect(totals.labor.map((l) => [l.label, l.hours, l.rate, l.cost])).toEqual([
      ["Body Labor", 24.6, 75, 1845],
      ["Paint Labor", 15.2, 75, 1140],
      ["Mechanical Labor", 0.2, 75, 15],
    ]);
    // Printed $1,855.00 and $584.50: the cover car ($10.00) and three scans ($569.50).
    expect(price(state.asMitchell, 87)).toBe(10);
    expect(price(state.asMitchell, 76, 78, 83)).toBe(569.5);
    expect(totals.misc).toBe(round2(10 + 569.5 + 273.86));
    expect(booked(state.asMitchell)).toBe(state.forensic.reconciliation.lowerSubtotal);
  });

  it("the Parts Adjustments markup is non-labor money that no line carries", () => {
    expect(state.asMitchell.totals.unlinedNonLabor).toEqual([{ label: "Parts Adjustments", cost: 273.86 }]);
    // 25% of the four taxed sublet parts, which the printed Parts include.
    expect(round2(price(state.asMitchell, 79, 80, 81, 82) * 0.25)).toBe(273.86);
  });

  it("the Paint/Materials line keeps its number and carries no price: its dollars are the printed paint materials", () => {
    const materials = state.asMitchell.lines.find((l) => l.line === 74)!;
    expect(materials.desc).toMatch(/Paint\/Materials/);
    expect(materials.price).toBeUndefined();
    expect(state.asMitchell.totals.paintSupplies.cost).toBe(912);
    expect(text).toMatch(/74AUTOPaint\/MaterialsAdditional\s+Cost\s+\$912\.00/);
  });
});

describe("RO 21011 (F-RK1b, Mitchell supplement)", () => {
  const { state } = pair("frk1b-mitchell-text.txt");

  it("booked as a CCC print books it, reproduces the measured finding", () => {
    expect(lineReconciliation(state.asCcc)).toEqual({ lineTotal: 7626.89, printed: 6598.49, residual: -1028.4, closes: false });
  });

  it("booked as the Mitchell print books it, the line read closes to the cent", () => {
    expect(lineReconciliation(state.asMitchell)).toEqual({ lineTotal: 6925.49, printed: 6925.49, residual: 0, closes: true });
    // Other Additional Costs $4.00, Body Sublet / Add'l $27.00, Mechanical $300.00.
    expect(state.asMitchell.totals.misc).toBe(331);
    expect(price(state.asMitchell, 80, 81, 83)).toBe(27);
    expect(price(state.asMitchell, 78, 79)).toBe(300);
    // Its Parts Adjustments print $0.00.
    expect(state.asMitchell.totals.unlinedNonLabor).toBeUndefined();
    expect(state.asMitchell.lines.find((l) => l.line === 75)!.price).toBeUndefined();
    expect(booked(state.asMitchell)).toBe(state.forensic.reconciliation.lowerSubtotal);
  });
});

describe("RO 22132 S3 (synthetic reconstruction of the Test 99 review)", () => {
  const { state } = pair("22132/sor3_mitchell_text.txt");

  it("booked as a CCC print books it, reproduces the measured finding", () => {
    expect(lineReconciliation(state.asCcc)).toEqual({ lineTotal: 3540.26, printed: 3215.26, residual: -325, closes: false });
  });

  it("closes but for L32, a $4.00 untaxed sublet cost its totals block books in no category", () => {
    const { totals } = state.asMitchell;
    // Body $21.00 + $150.00 and Mechanical $150.00 Sublet / Add'l are their lines.
    expect(price(state.asMitchell, 40, 43, 46)).toBe(171);
    expect(price(state.asMitchell, 38)).toBe(150);
    expect(totals.misc).toBe(321);
    // Every printed category is accounted for, and they reach the printed subtotal without L32.
    expect(booked(state.asMitchell)).toBe(state.forensic.reconciliation.lowerSubtotal);
    const l32 = state.asMitchell.lines.find((l) => l.line === 32)!;
    expect(l32).toMatchObject({ desc: expect.stringMatching(/Hazardous Waste/), price: 4 });
    expect(l32.hours).toBeUndefined();
    expect(lineReconciliation(state.asMitchell)).toEqual({ lineTotal: 3540.26, printed: 3536.26, residual: -4, closes: false });
    // A priced line the print does not total still refuses the report.
    expect(() => nonLaborBuckets(state.asMitchell, { strict: true })).toThrow(/line prices sum to 3540\.26, but the printed non-labor total is 3536\.26/);
  });
});

describe("the Appraisal Dispute Report is produced for a Mitchell carrier", () => {
  for (const file of ["frk2-mitchell-text.txt", "frk1b-mitchell-text.txt"]) {
    const { text, state } = pair(file);

    it(`${file}: the adapter, the ledger and the wording gate`, async () => {
      const adapted = adaptForensicToPlainSummary({
        reconciliation: state.forensic.reconciliation,
        rows: state.forensic.rows,
        higherDocumentName: "Shop 22084.pdf",
        lowerDocumentName: "Carrier Mitchell.pdf",
        higherText: shopText,
        lowerText: text,
        vehicleLabel: null,
        generatedAt: "2026-10-02T12:00:00.000Z",
      });
      if (!adapted.ok) throw new Error(adapted.reason);
      const model = buildPlainSummaryModel(adapted.input);
      expect(model.ledger.closes).toBe(true);
      // The open rate gap is rate × hours alone; no sublet dollars inside it.
      for (const item of model.ledger.rate.openRateItems.filter((i) => i.label !== "Paint materials")) {
        expect(item.dollars).toBe(round2((item.shopRate - item.carrierRate) * item.hours));
      }
      expect(model.ledger.laborRate).toBe(round2(model.ledger.rate.openRateItems.reduce((s, i) => s + (i.label === "Paint materials" ? 0 : i.dollars), 0)));
      // The paint materials line is the printed total, never a line "only they wrote".
      const document = plainSummaryDocumentText(buildPlainSummaryDocument(model));
      expect(document).not.toMatch(/Paint\/Materials/);
      const rendered = await renderPlainSummaryPdf(model);
      expect(rendered.pageCount).toBeGreaterThan(0);
    }, 60_000);
  }
});

describe("a CCC side is booked as it always was", () => {
  const row = (category: string, lower: [number | null, number | null, number | null]): ReconciliationRow => ({
    category,
    categoryKey: category.toUpperCase(),
    higherHours: null,
    higherRate: null,
    higherCost: null,
    lowerHours: lower[0],
    lowerRate: lower[1],
    lowerCost: lower[2],
    costDifference: lower[2],
    hoursDifference: null,
    ratesAgree: false,
    presentOnlyOn: "lower",
  });
  const clean = { categoriesSumToSubtotal: true, subtotalPlusTaxReachesGrandTotal: true, subtotalDiscrepancy: 0, grandTotalDiscrepancy: 0 };
  // 1.1 hr × $52.35 = $57.585, printed rounded; and a Parts Adjustments row.
  const reconciliation: ForensicReconciliation = {
    rows: [row("Parts", [null, null, 100]), row("Body Labor", [1.1, 52.35, 57.59]), row("Parts Adjustments", [null, null, 25])],
    higherSubtotal: 182.59,
    lowerSubtotal: 182.59,
    higherTax: 0,
    lowerTax: 0,
    higherGrandTotal: 182.59,
    lowerGrandTotal: 182.59,
    grandTotalDifference: 0,
    higherDeductible: null,
    lowerDeductible: null,
    unmatchedTaxLanes: [],
    allSharedRatesAgree: false,
    higherCheck: clean,
    lowerCheck: clean,
    balances: true,
  };

  it("keeps the printed labor cost and books Parts Adjustments as plain misc; a Mitchell side reads the rounding as labor too", () => {
    for (const platform of ["ccc", null] as const) {
      const read = totalsFromReconciliation(reconciliation, "lower", platform);
      if (!read.ok) throw new Error(read.reason);
      expect(read.totals.labor.map((l) => l.cost)).toEqual([57.59]);
      expect(read.totals.misc).toBe(25);
      expect(read.totals.unlinedNonLabor).toBeUndefined();
    }
    const mitchell = totalsFromReconciliation(reconciliation, "lower", "mitchell");
    if (!mitchell.ok) throw new Error(mitchell.reason);
    expect(mitchell.totals.labor.map((l) => l.cost)).toEqual([57.59]);
    expect(mitchell.totals.unlinedNonLabor).toEqual([{ label: "Parts Adjustments", cost: 25 }]);
  });
});

describe("the gross view counts a printed figure no line carries as its own unit", () => {
  const totals = (parts: number, misc: number, hours: number, extra: Partial<Estimate["totals"]> = {}): Estimate["totals"] => ({
    parts,
    misc,
    labor: [{ cat: "body", label: "Body Labor", hours, rate: 50, cost: hours * 50 }],
    paintSupplies: { hours: 0, rate: 0, cost: 0 },
    subtotal: parts + misc + hours * 50,
    tax: 0,
    grandTotal: parts + misc + hours * 50,
    ...extra,
  });
  const line = (price: number, hours: number) => ({ line: 1, oper: "Repl", desc: "Bumper cover", partNumber: "SYN1", price, hours, laborCat: "body" as const });
  const shop: Estimate = { role: "shop", fileName: "ours", vehicle: "", totals: totals(100, 0, 2), lines: [line(100, 2)] };
  const carrier: Estimate = {
    role: "carrier",
    fileName: "theirs",
    vehicle: "",
    totals: totals(80, 20, 1, { unlinedNonLabor: [{ label: "Parts Adjustments", cost: 20 }] }),
    lines: [line(80, 1)],
  };

  it("and the view reproduces the printed gap", () => {
    const ledger = buildGapLedger(shop, carrier);
    expect(ledger.gap).toBe(50);
    const view = buildShortPayView({ shop, carrier, ledger, groups: [], pairs: [] });
    expect(view).not.toBeNull();
    expect(view!.over).toEqual([{ label: "Parts Adjustments", shopLines: [], carrierLines: [], diff: -20 }]);
    expect(round2(view!.shortPaid - view!.carrierOver)).toBe(50);
  });
});
