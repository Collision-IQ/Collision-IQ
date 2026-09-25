/**
 * RO 21995 — the Appraisal Dispute Report rebuilt on one closed ledger.
 *
 * The shipped summary for this pair said: a -$9,115.20 parts gap because the
 * carrier "wrote used, aftermarket or reconditioned" parts; "$0.00" of carrier
 * sublet; a $1,212.70 rate gap; "23 of our lines have no match"; ADAS missing
 * "because we do not have the dealer invoice"; and cited Finding 41. Every one
 * of those was wrong against the two documents:
 *
 *   - both sheets are 100% OEM (the carrier's ALTERNATE PARTS USAGE is 0/0/0/0);
 *   - the carrier's Parts column carries a $3,728.00 rate concession and
 *     $3,768.63 of tows, dealer service and alignment;
 *   - the concession equals (90−65)×36.0 + (175−95)×34.6 + (135−75)×1.0, so the
 *     rates are settled and the gap is 18.4 hours = $2,364.50 at our rates;
 *   - HV, subframe and grounds are the same work under other names.
 *
 * Two layers of fixture:
 *   1. the hand-built line subset from the engine spec (strictLines: false);
 *   2. the production-path rows of the same two PDFs — the typed word-layer
 *      rows the pairing used, the matcher's deltas and the reconciliation —
 *      with PII-free text excerpts for notes, manual flags and the parts-usage
 *      page (tests/fixtures/21995). This one runs with the strict line guard ON.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { carrier, shop } from "./fixtures/ro21995AppraisalSummary";
import { buildGapLedger, LedgerNotClosedError, resolveRateBasis } from "../appraisalSummary/gapLedger";
import { classifyNonLabor, NonLaborParseError } from "../appraisalSummary/nonLaborBuckets";
import { partTypeEvidence } from "../appraisalSummary/partTypeEvidence";
import { groupEquivalents } from "../appraisalSummary/operationEquivalence";
import { integrityChecks } from "../appraisalSummary/integrityChecks";
import { buildSummaryFacts, lintSummaryText, lintSummaryUnits } from "../appraisalSummary/summaryGuards";
import {
  altPartsUsageFromText,
  lineAnnotationsFromText,
} from "../appraisalSummary/estimateFromDeltaRows";
import type { Estimate } from "../appraisalSummary/types";
import { adaptForensicToPlainSummary } from "../plainLanguageSummaryAdapter";
import {
  buildPlainSummaryDocument,
  buildPlainSummaryModel,
  plainSummaryDocumentText,
  plainSummaryDocumentUnits,
  renderPlainSummaryPdf,
  SummaryLintError,
  type PlainSummaryInput,
} from "../plainLanguageSummary";

const opts = { strictLines: false };

describe("RO 21995 ledger (spec fixture)", () => {
  const L = buildGapLedger(shop, carrier, opts);

  it("the rate adjustment reproduces our rates to the cent", () => {
    const r = resolveRateBasis(shop, carrier, opts);
    expect(r.adjustmentAmount).toBe(3728);
    expect(r.impliedAdjustment).toBe(3728);
    expect(r.settledByAdjustment).toBe(true);
    expect(r.openRateItems).toEqual([{ label: "Paint materials", shopRate: 60, carrierRate: 44, hours: 8.4, dollars: 134.4 }]);
  });

  it("closes to the penny", () => {
    expect(L.gap).toBe(2712.8);
    expect(L.laborHours).toEqual({ shop: 90, carrier: 71.6, diff: 18.4, dollars: 2364.5 });
    expect(L.laborRate).toBe(0);
    expect(L.paintMaterials).toBe(212.4);
    expect(L.nonLaborNet).toBe(77.12);
    expect(L.tax).toBe(58.78);
    expect(L.closes).toBe(true);
  });

  it("old bug: the carrier's parts column is NOT all parts", () => {
    const kind = (d: string) => classifyNonLabor(carrier.lines.find((l) => l.desc.startsWith(d))!);
    expect(kind("Concession")).toBe("rateAdjustment");
    expect(kind("Tow to sublet")).toBe("sublet");
    expect(kind("Rivian Service")).toBe("sublet");
    expect(kind("RT Strut")).toBe("part");
  });
});

describe("the ledger closes whatever the carrier did about rates", () => {
  // Spec bug: with a rate-adjustment line that does NOT reproduce the rate
  // gap, the spec's formula removed the adjustment from non-labor but never
  // added it back to labor, so the ledger could never close.
  const withConcession = (amount: number): Estimate => {
    const lines = carrier.lines.map((l) => (l.desc.startsWith("Concession") ? { ...l, price: amount } : l));
    const delta = amount - 3728;
    return {
      ...carrier,
      lines,
      totals: {
        ...carrier.totals,
        parts: carrier.totals.parts + delta,
        subtotal: carrier.totals.subtotal + delta,
        grandTotal: carrier.totals.grandTotal + delta,
      },
    };
  };

  it("no adjustment: the full rate gap is its own bucket", () => {
    const L = buildGapLedger(shop, withConcession(0), opts);
    expect(L.rate.settledByAdjustment).toBe(false);
    expect(L.laborRate).toBe(3728);
    expect(L.laborHours.dollars).toBe(2364.5);
    expect(L.gap).toBe(6440.8);
  });

  it("a partial adjustment leaves the remainder open, and still closes", () => {
    const L = buildGapLedger(shop, withConcession(1000), opts);
    expect(L.rate.settledByAdjustment).toBe(false);
    expect(L.laborRate).toBe(2728);
    expect(L.nonLaborNet).toBe(77.12);
    expect(L.gap).toBe(round(2712.8 + 2728));
  });

  it("refuses when the printed totals do not reconcile", () => {
    const broken = { ...carrier, totals: { ...carrier.totals, tax: carrier.totals.tax + 5 } };
    expect(() => buildGapLedger(shop, broken, opts)).toThrow(LedgerNotClosedError);
  });

  it("strict mode refuses an incomplete line read", () => {
    expect(() => buildGapLedger(shop, carrier, { strictLines: true })).toThrow(NonLaborParseError);
  });
});

describe("RO 21995 evidence (spec fixture)", () => {
  it("no part-type claim allowed; both OEM", () => {
    const pt = partTypeEvidence(shop, carrier);
    expect(pt.claimAllowed).toBe(false);
    expect(pt.bothAllOem).toBe(true);
  });

  it("renamed operations are grouped, not 'missing'", () => {
    const { groups } = groupEquivalents(shop, carrier);
    const g = Object.fromEntries(groups.map((x) => [x.key, x]));
    expect(g.hv.carrierHours).toBe(2.8);
    expect(g.subframe.carrierHours).toBe(5.5);
    expect(g.grounds.shopHours).toBe(2.0);
    expect(g.grounds.carrierHours).toBe(2.0);
    expect(g.adas.exclusions[0]).toMatch(/does not include calibrate windshield cameras/i);
  });

  it("integrity flags a shop manager must see", () => {
    const f = integrityChecks(shop, carrier);
    const kinds = (k: string) => f.filter((x) => x.kind === k);
    expect(kinds("carrierOnlyHighDollar").some((x) => x.lines.carrier?.[0] === 169 && x.lines.shop?.[0] === 129)).toBe(true);
    expect(kinds("trimConflictPartNumber").some((x) => x.lines.carrier?.[0] === 98)).toBe(true);
    expect(kinds("partWithoutLabor").some((x) => x.lines.carrier?.[0] === 61)).toBe(true);
    expect(kinds("reuseMismatch").some((x) => x.lines.carrier?.[0] === 134)).toBe(true);
    expect(kinds("laborCategoryMismatch").some((x) => x.lines.shop?.[0] === 25 && x.side === "shop")).toBe(true);
    expect(kinds("duplicatePartNumber").some((x) => x.side === "carrier")).toBe(true);
    expect(kinds("zeroPricedCarrierLine").some((x) => x.lines.carrier?.[0] === 57)).toBe(true);
    expect(kinds("duplicateOperation").length).toBeGreaterThan(0);
  });
});

describe("summary guardrails", () => {
  const L = buildGapLedger(shop, carrier, opts);
  const pt = partTypeEvidence(shop, carrier);
  const ctx = { ledger: L, partType: pt, hasDealerCalibrationSublet: false };

  it("facts are evidence-backed", () => {
    const f = buildSummaryFacts(L, pt, groupEquivalents(shop, carrier).groups, integrityChecks(shop, carrier));
    expect(f.notRates).toContain("$3,728.00");
    expect(f.mostlyHours).toContain("18.4 more labor hours");
    expect(f.mostlyHours).toContain("87%");
    expect(f.notParts).not.toBeNull();
    expect(f.adasSentence).toMatch(/windshield/);
  });

  it("every sentence of the old report is rejected", () => {
    const old = [
      "We wrote new factory parts. The insurer wrote used, aftermarket or reconditioned.",
      "Their estimate pays less per hour. That difference alone is real money on a job this size.",
      "That cost is not on the insurer's estimate yet because we do not have the dealer invoice yet.",
      "Miscellaneous / sublet $5,464.32 $0.00",
      "The single largest hours line to defend: bumper assy (Finding 41).",
    ];
    for (const sentence of old) expect(lintSummaryText(sentence, ctx).length).toBeGreaterThan(0);
  });

  it("the corrected sentences pass", () => {
    const ok =
      "Both estimates use new factory (OEM) parts; the carrier's parts-usage page lists zero aftermarket, used or reconditioned parts. " +
      "Nothing in the two reports says anyone acted in bad faith.";
    expect(lintSummaryText(ok, ctx)).toEqual([]);
  });

  it("lints unit by unit: an exemption in one sentence never excuses another", () => {
    // Whole-document lint (the spec's) would pass this pair because "zero
    // aftermarket" appears somewhere; per unit, the second claim is caught.
    const units = ["The carrier's page lists zero aftermarket parts.", "They wrote aftermarket parts on the bumper."];
    expect(lintSummaryText(units.join(" "), ctx)).toEqual([]);
    expect(lintSummaryUnits(units, ctx)).toHaveLength(1);
    // And a $0.00 figure is not a sublet claim unless the same unit says sublet.
    expect(lintSummaryUnits(["Labor rate $0.00", "Transport to / from sublet"], ctx)).toEqual([]);
  });

  it("'reused' and 'caused' are not part-type words", () => {
    expect(lintSummaryText("The part cannot be reused, which caused the add.", ctx)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Production-path rows of the same two PDFs
// ---------------------------------------------------------------------------

const FIXTURE_DIR = path.join(__dirname, "../../../../tests/fixtures/21995");
const delta = JSON.parse(readFileSync(path.join(FIXTURE_DIR, "delta_rows.json"), "utf8"));
const shopText = readFileSync(path.join(FIXTURE_DIR, "shop_final_rows_text.txt"), "utf8");
const sorText = readFileSync(path.join(FIXTURE_DIR, "sor3_rows_text.txt"), "utf8");

function adapt(overrides: Partial<Parameters<typeof adaptForensicToPlainSummary>[0]> = {}) {
  return adaptForensicToPlainSummary({
    reconciliation: delta.reconciliation,
    rows: { higher: delta.higher, lower: delta.lower, deltas: delta.deltas },
    higherDocumentName: "Shop final 21995.pdf",
    lowerDocumentName: "SOR-3 21995.pdf",
    higherText: shopText,
    lowerText: sorText,
    vehicleLabel: "2026 Rivian R1S",
    roNumber: "21995",
    identity: [{ label: "Vehicle", value: "2026 Rivian R1S" }, { label: "RO number", value: "21995" }],
    generatedAt: "2026-09-25T20:00:00.000Z",
    ...overrides,
  });
}

function realInput(): PlainSummaryInput {
  const adapted = adapt();
  if (!adapted.ok) throw new Error(adapted.reason);
  return adapted.input;
}

describe("RO 21995 from the production-path rows (strict line guard on)", () => {
  const input = realInput();
  const model = buildPlainSummaryModel(input);
  const doc = buildPlainSummaryDocument(model);
  const text = plainSummaryDocumentText(doc);

  it("reads the text-only facts the rows do not carry", () => {
    expect(altPartsUsageFromText(sorText)).toEqual({ aftermarket: 0, optionalOem: 0, reconditioned: 0, recycled: 0 });
    const notes = lineAnnotationsFromText(sorText);
    expect(notes.get(5)?.note).toMatch(/does not include calibrate windshield cameras/);
    expect(notes.get(57)?.manual).toBe(true);
    expect(notes.get(134)?.note).toMatch(/cannot be reused/);
    // A note continuation that starts with a digit is not a row.
    expect(notes.get(88)?.note).toMatch(/2 of these are required/);
    // The CCC user category "1" resolves to the Aluminum Or Steel Repair row.
    expect(input.shop.lines.find((l) => l.line === 16)?.laborCat).toBe("aluminum");
    // Supplement tag and op code glued into the typed row's description are split out.
    const damper = input.carrier.lines.find((l) => l.line === 169);
    expect(damper).toMatchObject({ desc: "Damper Module Assembly", supplement: "S02", manual: true, price: 1980 });
    expect(input.carrier.lines.find((l) => l.line === 102)).toMatchObject({ oper: "Repl", desc: "Susp subframe" });
  });

  it("the same ledger as the spec, from every line of both sheets", () => {
    expect(model.ledger.gap).toBe(2712.8);
    expect(model.ledger.laborHours).toEqual({ shop: 90, carrier: 71.6, diff: 18.4, dollars: 2364.5 });
    expect(model.ledger.laborRate).toBe(0);
    expect(model.ledger.rate).toMatchObject({ settledByAdjustment: true, adjustmentAmount: 3728, impliedAdjustment: 3728 });
    expect(model.ledger.paintMaterials).toBe(212.4);
    expect(model.ledger.nonLaborNet).toBe(77.12);
    expect(model.ledger.tax).toBe(58.78);
    expect(model.partType.bothAllOem).toBe(true);
  });

  it("groups the renamed work: the carrier pays MORE for HV", () => {
    const g = Object.fromEntries(model.groups.map((x) => [x.key, x]));
    expect([g.hv.shopHours, g.hv.carrierHours]).toEqual([2.8, 3.0]);
    expect([g.subframe.shopHours, g.subframe.carrierHours]).toEqual([5.8, 5.5]);
    expect([g.grounds.shopHours, g.grounds.carrierHours]).toEqual([2.0, 2.0]);
    expect(g.adas.carrierHours).toBe(3.0);
  });

  it("flags what a manager must see, on the right lines", () => {
    const of = (k: string) => model.flags.filter((f) => f.kind === k);
    expect(of("carrierOnlyHighDollar").map((f) => [f.lines.carrier?.[0], f.lines.shop?.[0]])).toEqual([[169, 129]]);
    expect(of("trimConflictPartNumber").map((f) => f.lines.carrier?.[0])).toEqual([98]);
    expect(of("partWithoutLabor").map((f) => f.lines.carrier?.[0])).toEqual([61]);
    // Upper to upper and lower to lower: a two-word stem sent both to L170.
    expect(of("reuseMismatch").map((f) => [f.lines.carrier?.[0], f.lines.shop?.[0]])).toEqual([[134, 170], [136, 171]]);
    const coding = of("laborCategoryMismatch").filter((f) => f.side === "shop" && /mechanical/.test(f.text));
    expect(coding.map((f) => f.lines.shop?.[0])).toEqual([25, 29, 30]);
    expect(coding.reduce((sum, f) => sum + (f.dollars ?? 0), 0)).toBeCloseTo(280.5, 2);
    expect(of("zeroPricedCarrierLine").map((f) => f.lines.carrier?.[0])).toEqual([57]);
    expect(of("duplicatePartNumber").some((f) => f.side === "carrier" && f.lines.carrier?.join() === "63,72")).toBe(true);
    const repeats = of("duplicateOperation").map((f) => f.lines.shop?.join());
    expect(repeats).toContain("188,202");
    expect(repeats).toContain("109,204");
    // RT and LT, and Rpr vs R&I, are different operations.
    expect(repeats.some((r) => r === "72,73" || r === "99,100")).toBe(false);
  });

  it("part-number variants are real ones only", () => {
    const variants = model.flags.filter((f) => f.kind === "partNumberVariant").map((f) => `${f.lines.shop?.[0]}/${f.lines.carrier?.[0]}`);
    expect(variants).toEqual(expect.arrayContaining(["129/90", "135/102", "145/82", "174/138", "175/139"]));
    // "RT Air guide clip" is not the "RT Air guide"; the subframe bolt SC00002055A is on both sheets.
    expect(variants.some((v) => v.startsWith("53/") || v.startsWith("143/") || v.startsWith("81/"))).toBe(false);
  });

  it("ranks the items: STRONG from their own documents first", () => {
    const top = model.items.slice(0, 3).map((i) => [i.strength, i.title, i.value]);
    expect(top).toEqual([
      ["Strong", "Tires", 1192.6],
      ["Strong", "ADAS calibration & diagnostics", 525],
      ["Strong", "Oil pump: install labor", 175],
    ]);
    const bumper = model.items.find((i) => /bumper assy/.test(i.title));
    expect(bumper).toMatchObject({ strength: "Needs proof", hours: 2.7, value: 243 });
    // HV is grouped, so it is never an item; the carrier pays more there.
    expect(model.items.some((i) => /high voltage/i.test(i.title))).toBe(false);
  });

  it("prints none of the old report's false claims", () => {
    expect(text).not.toMatch(/Finding \d+/);
    expect(text).not.toMatch(/dealer invoice/i);
    expect(text).not.toMatch(/1,212\.70|9,115\.20/);
    expect(text).not.toMatch(/pays? less per hour/i);
    expect(text).not.toMatch(/have no match on their sheet/);
    expect(text).toContain("$2,364.50");
    expect(text).toContain("Check this first");
    expect(text).toContain("Items worth arguing");
    expect(text).toContain("Clean up our own sheet");
    expect(lintSummaryUnits(plainSummaryDocumentUnits(doc), model.lint)).toEqual([]);
  });

  it("shows a Labor rate row only when the rates are not settled", () => {
    const rows = doc.sections.find((s) => s.title === "Where the money comes from")!.blocks.find((b) => b.kind === "table");
    const labels = rows && rows.kind === "table" ? rows.rows.map((r) => r.cells[0]) : [];
    expect(labels).toEqual(["Labor hours", "Labor rate", "Paint materials", "Parts, sublet, supplies (net)", "Tax", "Total"]);
    const rateRow = rows && rows.kind === "table" ? rows.rows[1].cells.join(" ") : "";
    expect(rateRow).toMatch(/\$0\.00 Settled by the carrier's \$3,728\.00 rate adjustment/);
  });

  it("the owner note uses ledger figures and never promises a payment or a date", () => {
    const note = doc.sections.find((s) => /note for the owner/.test(s.title))!;
    const callout = note.blocks.find((b) => b.kind === "callout");
    const body = callout && callout.kind === "callout" ? callout.paragraphs.join(" ") : "";
    expect(body).toContain("$2,712.80");
    expect(body).toContain("87%");
    expect(body).toContain("18.4 more hours");
    expect(body).toMatch(/new factory parts/);
    expect(body).toMatch(/calibrated after the repair/);
    expect(body).not.toMatch(/\bL\d+\b|will pay|within \d+ days|by (Monday|Friday)/i);
  });

  it("renders through the shared forensic renderer", async () => {
    const pdf = await renderPlainSummaryPdf(model);
    expect(pdf.pageCount).toBeGreaterThanOrEqual(3);
    expect(Buffer.from(pdf.bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });
});

describe("the ship gate refuses, it never softens", () => {
  it("rendered text that fails a wording check is not rendered", async () => {
    const input = realInput();
    // A description that would print a Forensic finding number in the items table.
    input.shop = {
      ...input.shop,
      lines: input.shop.lines.map((l) => (l.line === 148 ? { ...l, desc: "Measure ride height per Finding 12" } : l)),
    };
    const model = buildPlainSummaryModel(input);
    await expect(renderPlainSummaryPdf(model)).rejects.toBeInstanceOf(SummaryLintError);
    try {
      await renderPlainSummaryPdf(model);
    } catch (error) {
      expect((error as SummaryLintError).violations[0]).toMatch(/finding number.*Finding 12/i);
    }
  });
});

describe("the adapter refuses rather than guessing", () => {
  it("no line items read", () => {
    const adapted = adapt({ rows: { higher: [], lower: delta.lower, deltas: [] } });
    expect(adapted).toMatchObject({ ok: false });
  });

  it("a grand total that could not be read", () => {
    const adapted = adapt({ reconciliation: { ...delta.reconciliation, lowerGrandTotal: null } });
    expect(adapted.ok).toBe(false);
    if (!adapted.ok) expect(adapted.reason).toMatch(/their estimate's subtotal, tax or grand total/);
  });

  it("an annotated estimate that is not the higher one", () => {
    const swapped = {
      ...delta.reconciliation,
      higherGrandTotal: delta.reconciliation.lowerGrandTotal,
      lowerGrandTotal: delta.reconciliation.higherGrandTotal,
    };
    const adapted = adapt({ reconciliation: swapped });
    expect(adapted.ok).toBe(false);
  });

  it("applies the run's redaction policy to names and descriptions", () => {
    const adapted = adapt({ scrub: (value) => value.replace(/Damper/g, "[X]").replace(/21995/g, "[RO]") });
    if (!adapted.ok) throw new Error(adapted.reason);
    expect(adapted.input.shop.fileName).toBe("Shop final [RO].pdf");
    expect(adapted.input.carrier.lines.find((l) => l.line === 169)?.desc).toBe("[X] Module Assembly");
  });
});

function round(n: number) {
  return Math.round(n * 100) / 100;
}
