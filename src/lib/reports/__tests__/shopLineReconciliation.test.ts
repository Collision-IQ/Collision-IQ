/**
 * Our sheet's line read is held to its own printed totals, as the carrier's is.
 *
 * RO 22279 (CCC ONE shop estimate against the carrier's SOR): the row-anchor
 * table region dropped two priced shop rows, a $504.49 skid plate and a
 * $502.50 reinforcement. The shop line prices reaching the Appraisal Dispute
 * Report adapter came to $1,970.69 while the sheet printed $2,977.68 of
 * Parts + Misc; the $1,006.99 residual was exactly the two rows. The strict
 * line guard checked only the carrier's lines against the carrier's print, so
 * nothing noticed, and "Check this first" told the shop that the carrier's
 * reinforcement was "not on our sheet".
 *
 * The fixture is synthetic (the PDFs carry PII and are not in the
 * repository): the same Parts + Misc, line-read total and two lost rows, on a
 * small pair built to close to the cent, entering through the same adapter the
 * pipeline calls. Whether RO 22279's two rows carried hours is not known here,
 * so both shapes are covered: priced rows with no hours (the report ships with
 * its absence claims withheld) and rows that carry hours (no report: every
 * hour it quotes would rest on an incomplete read, as the typed lane already
 * rules). Their sheet reading short is disclosed instead (RO 22279's partial
 * carrier read).
 */
import { describe, expect, it } from "vitest";
import type { EstimateDeltaRow } from "../estimateDeltaMatcher";
import { tokenizeDescription } from "../estimateDeltaMatcher";
import type { ForensicReconciliation, ReconciliationRow } from "../forensicEstimateAnalysis";
import { hoursReconcile } from "../deltaEngine/rowCluster";
import { buildGapLedger, lineHoursRead } from "../appraisalSummary/gapLedger";
import { integrityChecks } from "../appraisalSummary/integrityChecks";
import { buildLowerEstimateFindings } from "../appraisalSummary/lowerEstimateFindings";
import { lineReconciliation, nonLaborBuckets, NonLaborParseError } from "../appraisalSummary/nonLaborBuckets";
import { lintSummaryText } from "../appraisalSummary/summaryGuards";
import { adaptForensicToPlainSummary } from "../plainLanguageSummaryAdapter";
import {
  buildPlainSummaryDocument,
  buildPlainSummaryModel,
  plainSummaryDocumentText,
  renderPlainSummaryPdf,
  type PlainSummaryInput,
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

/** Both printed ESTIMATE TOTALS blocks. `carrierExtra` adds a carrier-only part to the carrier's Parts. */
function reconciliation(carrierExtra = 0): ForensicReconciliation {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    rows: [
      category("Parts", [null, null, 2727.68], [null, null, r2(2612.19 + carrierExtra)]),
      category("Body Labor", [20, 62, 1240], [15, 58, 870]),
      category("Paint Labor", [8, 62, 496], [6, 58, 348]),
      category("Paint Supplies", [8, 42, 336], [6, 38, 228]),
      category("Miscellaneous", [null, null, 250], [null, null, 130]),
    ],
    higherSubtotal: 5049.68,
    lowerSubtotal: r2(4188.19 + carrierExtra),
    higherTax: 183.82,
    lowerTax: 156.6,
    higherGrandTotal: 5233.5,
    lowerGrandTotal: r2(4344.79 + carrierExtra),
    grandTotalDifference: r2(4344.79 + carrierExtra - 5233.5),
    higherDeductible: null,
    lowerDeductible: null,
    unmatchedTaxLanes: [],
    allSharedRatesAgree: false,
    higherCheck: clean,
    lowerCheck: clean,
    balances: true,
  };
}

function row(
  lineNumber: number,
  opCode: string | null,
  description: string,
  cells: { pn?: string; price?: number; labor?: number; paint?: number; source?: string[] } = {}
): EstimateDeltaRow {
  return {
    lineNumber,
    opCode,
    description,
    descriptionTokens: tokenizeDescription(description),
    partNumber: cells.pn ?? null,
    section: null,
    qty: cells.price !== undefined ? 1 : null,
    price: cells.price ?? null,
    labor: cells.labor ?? null,
    laborIncluded: false,
    paint: cells.paint ?? null,
    paintIncluded: false,
    laborType: null,
    partSource: cells.source ?? [],
    rawText: "",
  };
}

// Our sheet: Parts $2,727.68 + Misc $250.00 = $2,977.68, 20.0 body + 8.0 paint hours.
const SKID_PLATE = 34;
const REINFORCEMENT = 35;
const shopRows: EstimateDeltaRow[] = [
  row(3, "Repl", "Front bumper cover", { pn: "SYN10003", price: 612.35, labor: 2.5, paint: 3.5 }),
  row(4, "Repl", "Front bumper absorber", { pn: "SYN10004", price: 143.2, labor: 0.4 }),
  row(8, "Repl", "RT Headlamp assy", { pn: "SYN10008", price: 864.95, labor: 0.6 }),
  row(12, "Repl", "Grille", { pn: "SYN10012", price: 100.19, labor: 0.5 }),
  row(20, "Rpr", "RT Fender", { labor: 6, paint: 2.5 }),
  row(21, "Rpr", "Hood", { labor: 4, paint: 2 }),
  row(22, "Rpr", "LT Fender", { labor: 6 }),
  // Priced with no hours of their own, so losing them leaves the hours whole:
  // the report is produced and only its absence claims are at stake. Losing
  // rows that carry hours refuses the report (see "line hours" below).
  row(SKID_PLATE, "Repl", "Skid plate", { pn: "SYN10034", price: 504.49 }),
  row(REINFORCEMENT, "Repl", "Reinforcement", { pn: "SYN10035", price: 502.5 }),
  row(40, null, "Hazardous waste disposal", { price: 5 }),
  row(41, "Subl", "Pre-repair scan", { price: 125 }),
  row(42, "Subl", "Post-repair scan", { price: 120 }),
];
/** What reached the adapter on the failing run: the two rows the table region dropped. */
const shopRowsDropped = shopRows.filter((r) => r.lineNumber !== SKID_PLATE && r.lineNumber !== REINFORCEMENT);

// Their sheet: Parts $2,612.19 + Misc $130.00, 15.0 body + 6.0 paint hours. L28 is
// the same reinforcement (part number) as our L35; their skid plate is A/M.
const carrierRows: EstimateDeltaRow[] = [
  row(3, "Repl", "Front bumper cover", { pn: "SYN10003", price: 612.35, labor: 2, paint: 3 }),
  row(4, "Repl", "Front bumper absorber", { pn: "SYN10004", price: 143.2, labor: 0.4 }),
  row(8, "Repl", "RT Headlamp assy", { pn: "SYN10008", price: 864.95, labor: 0.6 }),
  row(12, "Repl", "Grille", { pn: "SYN10012", price: 100.19, labor: 0.5 }),
  row(18, "Rpr", "RT Fender", { labor: 4.5, paint: 2 }),
  row(19, "Rpr", "Hood", { labor: 3, paint: 1 }),
  row(27, "Repl", "Skid plate", { pn: "SYN20034", price: 389, labor: 1, source: ["A/M"] }),
  row(28, "Repl", "Reinforcement", { pn: "SYN10035", price: 502.5, labor: 2 }),
  row(29, "Rpr", "LT Fender", { labor: 1 }),
  row(30, null, "Hazardous waste disposal", { price: 5 }),
  row(31, "Subl", "Pre-repair scan", { price: 125 }),
];
/** A part only the carrier wrote, $612.00, at the end of its sheet. */
const carrierOnlyPart = row(32, "Repl", "Front tow hook bracket", { pn: "SYN20032", price: 612 });

function adapt(params: { shop: EstimateDeltaRow[]; carrier?: EstimateDeltaRow[]; carrierExtra?: number; carrierText?: string }) {
  return adaptForensicToPlainSummary({
    reconciliation: reconciliation(params.carrierExtra),
    rows: { higher: params.shop, lower: params.carrier ?? carrierRows, deltas: [] },
    higherDocumentName: "Shop estimate.pdf",
    lowerDocumentName: "Carrier SOR.pdf",
    higherText: "",
    lowerText: params.carrierText ?? "",
    vehicleLabel: "Synthetic test vehicle",
    generatedAt: "2026-10-02T12:00:00.000Z",
  });
}

function input(params: Parameters<typeof adapt>[0]): PlainSummaryInput {
  const adapted = adapt(params);
  if (!adapted.ok) throw new Error(adapted.reason);
  return adapted.input;
}

const whole = buildPlainSummaryModel(input({ shop: shopRows }));
const dropped = buildPlainSummaryModel(input({ shop: shopRowsDropped }));
const of = (flags: typeof whole.flags, kind: string) => flags.filter((f) => f.kind === kind);

describe("our line read is reconciled with the carrier-side rule", () => {
  it("is the same computation the strict guard refuses the carrier on", () => {
    const shop = input({ shop: shopRowsDropped }).shop;
    expect(lineReconciliation(shop)).toEqual({ lineTotal: 1970.69, printed: 2977.68, residual: 1006.99, closes: false });
    expect(() => nonLaborBuckets(shop, { strict: true })).toThrow(NonLaborParseError);
    expect(() => nonLaborBuckets(shop, { strict: true })).toThrow(/line prices sum to 1970\.69, but the printed non-labor total is 2977\.68/);
    expect(lineReconciliation(input({ shop: shopRows }).shop)).toEqual({ lineTotal: 2977.68, printed: 2977.68, residual: 0, closes: true });
  });

  it("a row read twice is unreconciled too, and is stated without a negative figure", () => {
    const scan = shopRows.find((r) => r.lineNumber === 41)!;
    const twice = buildPlainSummaryModel(input({ shop: [...shopRows, { ...scan, lineNumber: 43 }] }));
    expect(twice.ledger.shopLineRead).toEqual({ lineTotal: 3102.68, printed: 2977.68, residual: -125, closes: false });
    const [flag] = of(twice.flags, "shopLinesUnreconciled");
    expect(flag.text).toContain("add up to $3,102.68, but it prints $2,977.68 for parts and other priced items, a $125.00 difference");
    expect(flag.text).not.toMatch(/-\$/);
    expect(lintSummaryText(flag.text, twice.lint)).toEqual([]);
  });

  it("never refuses the ledger: every bucket comes from the printed totals", () => {
    expect(whole.ledger.shopLineRead?.closes).toBe(true);
    expect(dropped.ledger.shopLineRead).toEqual({ lineTotal: 1970.69, printed: 2977.68, residual: 1006.99, closes: false });
    expect({ ...dropped.ledger, shopLineRead: null }).toEqual({ ...whole.ledger, shopLineRead: null });
    expect(dropped.ledger.gap).toBe(888.71);
  });
});

describe("a whole read: the reinforcement is on our sheet and nothing is withheld", () => {
  it("matches their L28 to our L35 and raises no read flag", () => {
    expect(of(whole.flags, "carrierOnlyHighDollar")).toEqual([]);
    expect(of(whole.flags, "shopLinesUnreconciled")).toEqual([]);
    expect(whole.shortPay).not.toBeNull();
  });
});

describe("two priced rows lost from our read", () => {
  const text = plainSummaryDocumentText(buildPlainSummaryDocument(dropped));

  it("no longer says the carrier's reinforcement is not on our sheet", () => {
    expect(of(dropped.flags, "carrierOnlyHighDollar")).toEqual([]);
    expect(text).not.toMatch(/not on our sheet/i);
    expect(text).not.toMatch(/line only they wrote/);
  });

  it("states the residual under Check this first and names the line to look for", () => {
    const [flag] = of(dropped.flags, "shopLinesUnreconciled");
    expect(flag).toMatchObject({ side: "shop", lines: { carrier: [28] }, dollars: 1006.99 });
    expect(flag.text).toContain("add up to $1,970.69, but it prints $2,977.68");
    expect(flag.text).toContain("a $1,006.99 difference: some of our lines were not read, or were misread.");
    expect(flag.text).toContain("nothing here says a carrier line is missing from our sheet");
    expect(flag.text).toContain('Not found among the lines read: carrier L28 "Reinforcement" ($502.50)');
    expect(dropped.facts.checkFirst.map((f) => f.kind)).toEqual(["shopLinesUnreconciled"]);
    expect(dropped.facts.cleanUpOurs.some((f) => f.kind === "shopLinesUnreconciled")).toBe(false);
    expect(text).toContain(flag.text);
  });

  it("drops the gross view, whose carrier-only figure needs every line of ours", () => {
    expect(dropped.shortPay).toBeNull();
    expect(text).not.toContain("Short-paid vs. what only they wrote");
  });

  it("still ships past the wording gate", async () => {
    const rendered = await renderPlainSummaryPdf(dropped);
    expect(rendered.pageCount).toBeGreaterThan(0);
  });

  it("the lower-estimate copy says 'not found among the lines read', never 'Not on ours'", () => {
    const set = buildLowerEstimateFindings(dropped, []);
    const l28 = set.findings.find((f) => f.carrierLine === 28)!;
    const entries = l28.entries.map((e) => e.text).join(" ");
    expect(entries).not.toMatch(/Not on ours/);
    expect(entries).toMatch(/Reinforcement \(2\.0 hr, \$502\.50\): on this estimate, \$626\.50; not found among the lines read from ours/);
    expect(l28.entries[0]).toMatchObject({ kind: "check" });
  });
});

describe("a carrier line that really is not on our sheet", () => {
  const extra = { carrier: [...carrierRows, carrierOnlyPart], carrierExtra: 612 };

  it("is still flagged when our read closes", () => {
    const model = buildPlainSummaryModel(input({ shop: shopRows, ...extra }));
    const flags = of(model.flags, "carrierOnlyHighDollar");
    expect(flags.map((f) => f.lines.carrier)).toEqual([[32]]);
    expect(flags[0].text).toMatch(/^Carrier L32 "Front tow hook bracket" \(\$612\.00\) is not on our sheet\./);
    const set = buildLowerEstimateFindings(model, []);
    expect(set.findings.find((f) => f.carrierLine === 32)!.entries.map((e) => e.text).join(" ")).toMatch(/Not on ours\./);
  });

  it("is listed for checking, not asserted absent, when our read does not close", () => {
    const model = buildPlainSummaryModel(input({ shop: shopRowsDropped, ...extra }));
    expect(of(model.flags, "carrierOnlyHighDollar")).toEqual([]);
    const [flag] = of(model.flags, "shopLinesUnreconciled");
    expect(flag.lines.carrier).toEqual([28, 32]);
    expect(flag.text).toContain('carrier L28 "Reinforcement" ($502.50), L32 "Front tow hook bracket" ($612.00). Look for them');
  });
});

describe("the wording gate refuses an absence claim over an unreconciled read", () => {
  const claim = 'Carrier L28 "Reinforcement" ($502.50) is not on our sheet.';

  it("as a violation when our read does not close", () => {
    expect(lintSummaryText(claim, dropped.lint)).toEqual([
      "Says our sheet lacks a line, but the line prices read from our sheet do not reproduce its printed totals.",
    ]);
    expect(lintSummaryText("Short-paid vs. what only they wrote", dropped.lint)).toHaveLength(1);
  });

  it("not when it closes", () => {
    expect(lintSummaryText(claim, whole.lint)).toEqual([]);
  });
});

describe("partial fixtures (strictLines off) are not held to the print", () => {
  it("records no read and leaves the direct integrity check as it was", () => {
    const { shop, carrier } = input({ shop: shopRowsDropped });
    expect(buildGapLedger(shop, carrier, { strictLines: false }).shopLineRead).toBeNull();
    expect(of(integrityChecks(shop, carrier), "carrierOnlyHighDollar").map((f) => f.lines.carrier)).toEqual([[28]]);
  });
});

describe("line hours: both sheets are held to their printed labor hours, column by column", () => {
  const without = (rows: EstimateDeltaRow[], line: number) => rows.filter((r) => r.lineNumber !== line);
  const edit = (rows: EstimateDeltaRow[], line: number, cells: Partial<EstimateDeltaRow>) =>
    rows.map((r) => (r.lineNumber === line ? { ...r, ...cells } : r));
  const refusal = (params: Parameters<typeof adapt>[0]) => {
    const adapted = adapt(params);
    return adapted.ok ? null : adapted.reason;
  };

  it("a whole read closes on both sides", () => {
    expect(lineHoursRead(whole.shop)).toEqual({ labor: { lines: 20, printed: 20 }, paint: { lines: 8, printed: 8 }, closes: true });
    expect(lineHoursRead(whole.carrier)).toEqual({ labor: { lines: 15, printed: 15 }, paint: { lines: 6, printed: 6 }, closes: true });
  });

  it("losing a row that carries hours ships no report, and the reason states the figures", () => {
    expect(refusal({ shop: without(shopRows, 21) })).toBe(
      "our estimate's lines carry 16.0 labor and 6.0 paint hours as read, but it prints 20.0 and 8.0, so any hour the report quoted could be a misread line rather than what the estimate says"
    );
  });

  it("paint hours read into the labor column are refused even though the total closes", () => {
    // The shape the text lane reads on the repository's CCC fixtures: labor too high, paint too low.
    expect(refusal({ shop: edit(shopRows, 20, { labor: 8.5, paint: null }) })).toMatch(
      /^our estimate's lines carry 22\.5 labor and 5\.5 paint hours as read, but it prints 20\.0 and 8\.0/
    );
  });

  // The disclosure is measured on a CCC print only (unreadCarrierHours).
  const ccc = "CCC ONE Estimating";

  it("their CCC sheet reading short ships with the hours disclosed and no item argued", () => {
    const adapted = adapt({ shop: shopRows, carrier: without(carrierRows, 19), carrierText: ccc });
    expect(adapted.ok).toBe(true);
    if (!adapted.ok) return;
    expect(adapted.input.carrier.platform).toBe("ccc");
    const m = buildPlainSummaryModel(adapted.input);
    expect(m.ledger.unreadCarrierHours).toBe(4);
    expect(m.items).toEqual([]);
  });

  it("their sheet with a column over its print is a misread, and both are named when both fail", () => {
    expect(refusal({ shop: shopRows, carrier: edit(carrierRows, 18, { labor: 6.5, paint: null }), carrierText: ccc })).toMatch(
      /^their estimate's lines carry 17\.0 labor and 4\.0 paint hours as read, but it prints 15\.0 and 6\.0/
    );
    expect(refusal({ shop: without(shopRows, 21), carrier: edit(carrierRows, 18, { labor: 6.5, paint: null }) })).toMatch(
      /^our estimate's lines carry 16\.0 .*; their estimate's lines carry 17\.0 /
    );
    // A shortfall on theirs never masks a refusal on ours.
    expect(refusal({ shop: without(shopRows, 21), carrier: without(carrierRows, 19), carrierText: ccc })).toMatch(/^our estimate's lines carry 16\.0 [^;]*$/);
    // Off CCC no shortfall is measured, so their short read still refuses.
    expect(refusal({ shop: shopRows, carrier: without(carrierRows, 19) })).toMatch(/^their estimate's lines carry 12\.0 labor and 5\.0 paint/);
  });

  it("allows the typed lane's 0.2 hr and no more", () => {
    expect(refusal({ shop: edit(shopRows, 22, { labor: 6.2 }) })).toBeNull();
    expect(refusal({ shop: edit(shopRows, 22, { labor: 6.3 }) })).toMatch(/20\.3 labor/);
    // The one rule the column-identity guard (RC-3) also applies.
    expect([hoursReconcile(28.2, 28), hoursReconcile(27.8, 28), hoursReconcile(28.3, 28), hoursReconcile(5, null)]).toEqual([true, true, false, true]);
  });
});
