/**
 * The Appraisal Dispute Report's contract: every figure it prints is the
 * Forensic report's figure to the cent, an absent basis is never a zero, the
 * fixed copy stays inside the wording rules, and the adapter reads the
 * pipeline's own finding objects rather than a hand-typed shape.
 */
import { describe, expect, it } from "vitest";
import type { CitationDensityFinding } from "@/lib/ai/types/estimateScrubber";
import { buildForensicReconciliation } from "../forensicEstimateAnalysis";
import { findBannedPhrases } from "../deltaWording";
import {
  buildPlainSummaryDocument,
  buildPlainSummaryModel,
  plainSummaryDocumentText,
  renderPlainSummaryPdf,
  type PlainSummaryInput,
} from "../plainLanguageSummary";
import { adaptForensicToPlainSummary } from "../plainLanguageSummaryAdapter";
import { RO22264 } from "./fixtures/ro22264PlainSummary";

const model = buildPlainSummaryModel(RO22264);
const bucket = (key: string) => model.buckets.find((b) => b.key === key)!;

describe("RO 22264 — the numbers the hand-built summary printed", () => {
  it("reconciliation table matches Forensic report Section 4 to the cent", () => {
    expect(model.header.gap).toBe(14151.48);
    expect(bucket("parts").gap).toBe(6459.36);
    expect(bucket("bodyLabor").gap).toBe(2235.0);
    expect(bucket("paintLabor").gap).toBe(1785.0);
    expect(bucket("paintSupplies").gap).toBe(1662.0);
    expect(bucket("misc").gap).toBe(1243.22);
    expect(bucket("tax").gap).toBe(766.9);
    expect(bucket("total").ours).toBe("$26,265.20");
    expect(bucket("total").theirs).toBe("$12,113.72");
    expect(bucket("bodyLabor").ours).toBe("77.0 hr @ $75");
    expect(bucket("bodyLabor").theirs).toBe("59.0 hr @ $60");
  });

  it("rate-only effect on our hours: 77×15 + 44.6×15 + 44.6×21 = 2,760.60; the remainder is hours", () => {
    expect(model.rateEffect).not.toBeNull();
    expect(model.rateEffect!.body).toBe(1155.0);
    expect(model.rateEffect!.paint).toBe(669.0);
    expect(model.rateEffect!.supplies).toBe(936.6);
    expect(model.rateEffect!.total).toBe(2760.6);
    expect(model.rateEffect!.hoursEffect).toBe(2921.4);
    expect(model.rateEffect!.excluded).toEqual([]);
    expect(model.hoursGap).toEqual({ body: 18.0, paint: 18.6 });
  });

  it("parts: mirror, wheel, fender lead; ADAS and misc lines excluded", () => {
    expect(model.parts.top.slice(0, 3).map((x) => x.title)).toEqual([
      "RT Mirror assy power folding w/side camera",
      "RT/Front Wheel, alloy 5 spoke/code 40T",
      "RT Fender",
    ]);
    expect(model.parts.top.some((x) => /alignment|transport|scan/i.test(x.title))).toBe(false);
    expect(model.lowerOnlyCount).toBe(47);
    expect(model.missingLineCount).toBe(107);
  });

  it("paint hours: blends and clear-coat adds, biggest first", () => {
    expect(model.paintHours[0].title).toBe("Blnd RT Ctr plr & rocker");
    expect(model.paintHours[0].hours).toBe(3.6);
  });

  it("body hours include the door shell and test fits; the bumper overhaul is surfaced separately", () => {
    expect(model.bodyHours.some((x) => /Door shell/.test(x.title))).toBe(true);
    expect(model.bodyHours.some((x) => /Test fit/.test(x.title))).toBe(true);
    expect(model.bumperOverhaul?.id).toBe(27);
  });

  it("ADAS: seven $0.01 placeholders; the pre-repair scan is the priced-differently example", () => {
    expect(model.adas.placeholders).toHaveLength(7);
    expect(model.adas.scanPriceDiff?.id).toBe(25);
  });

  it("misc: alignment and transport present; support review flagged", () => {
    expect(model.misc.some((x) => /alignment/i.test(x.title))).toBe(true);
    expect(model.misc.some((x) => /Transport/.test(x.title))).toBe(true);
    expect(model.supportReview[0]?.lineA).toBe(208);
  });

  it("the document prints the headline figures and nothing undefined", () => {
    const doc = buildPlainSummaryDocument(model);
    const text = plainSummaryDocumentText(doc);
    expect(text).toContain("$14,151.48");
    expect(text).toContain("$2,760.60");
    expect(text).toContain("107 of our lines");
    expect(text).toContain("Finding 27");
    expect(text).toContain("Pre-repair scan +34%: $201.00 on ours, $0.00 on theirs.");
    expect(text).not.toMatch(/undefined|NaN|\[object/);
    expect(doc.footerLine).toBe("Appraisal Dispute Report | RO 22264 | 2023 Audi Q5 45 S Line Prestige | Shop staff only");
    expect(doc.sections.map((section) => section.title)).toEqual([
      "The thirty-second version",
      "Where the money is",
      "The four kinds of difference you will see",
      "Bucket by bucket: what to say",
      "Things to say, things not to say",
      "The honest caveat: what these reports prove and what they do not",
      "What happens next",
      "Reading the two companion reports",
    ]);
  });

  it("stays inside the wording rules the release gate enforces", () => {
    const text = plainSummaryDocumentText(buildPlainSummaryDocument(model));
    expect(findBannedPhrases(text)).toEqual([]);
  });

  it("renders through the shared forensic renderer and reads back", async () => {
    const rendered = await renderPlainSummaryPdf(model);
    expect(rendered.pageCount).toBeGreaterThan(1);
    expect(rendered.bytes.byteLength).toBeGreaterThan(5000);
    const pdfParse = (await import("pdf-parse")).default as (b: Buffer) => Promise<{ text: string }>;
    const { text } = await pdfParse(Buffer.from(rendered.bytes));
    expect(text).toMatch(/Appraisal Dispute Report/);
    expect(text).toMatch(/\$14,151\.48/);
    expect(text).toMatch(/Shop staff only/);
    expect(text).toMatch(/Page 1/);
  });
});

describe("an absent basis is not a zero basis", () => {
  it("a flat materials figure with no hours or rate is named, not multiplied", () => {
    const input: PlainSummaryInput = {
      ...RO22264,
      docB: {
        ...RO22264.docB,
        totals: { ...RO22264.docB.totals, paintSupplies: { hours: null, rate: null, total: 650.0 } },
      },
    };
    const flat = buildPlainSummaryModel(input);
    expect(flat.buckets.find((b) => b.key === "paintSupplies")!.theirs).toBe("flat $650.00, no hrs/rate shown");
    expect(flat.buckets.find((b) => b.key === "paintSupplies")!.gap).toBe(2026.0);
    expect(flat.rateEffect!.supplies).toBeNull();
    expect(flat.rateEffect!.total).toBe(1824.0);
    expect(flat.rateEffect!.excluded).toEqual(["paint supplies"]);
    const text = plainSummaryDocumentText(buildPlainSummaryDocument(flat));
    expect(text).toContain("Paint supplies is left out of this split");
  });

  it("a category one document does not print is 'not shown' and its gap is not quantified", () => {
    const input: PlainSummaryInput = {
      ...RO22264,
      docB: { ...RO22264.docB, totals: { ...RO22264.docB.totals, miscellaneous: null } },
      unpricedCategories: ["Miscellaneous"],
    };
    const partial = buildPlainSummaryModel(input);
    const misc = partial.buckets.find((b) => b.key === "misc")!;
    expect(misc.theirs).toBe("not shown");
    expect(misc.gap).toBeNull();
    const text = plainSummaryDocumentText(buildPlainSummaryDocument(partial));
    expect(text).toContain("Miscellaneous and sublet (not quantified gap)");
    expect(text).toContain("Not quantified: Miscellaneous.");
  });

  it("no rate difference means no rate block at all", () => {
    const input: PlainSummaryInput = {
      ...RO22264,
      docB: {
        ...RO22264.docB,
        totals: {
          ...RO22264.docB.totals,
          bodyLabor: { hours: 59, rate: 75, total: 4425 },
          paintLabor: { hours: 26, rate: 75, total: 1950 },
          paintSupplies: { hours: 26, rate: 60, total: 1560 },
        },
      },
    };
    const same = buildPlainSummaryModel(input);
    expect(same.rateEffect).toBeNull();
    const text = plainSummaryDocumentText(buildPlainSummaryDocument(same));
    expect(text).not.toContain("The rate piece by itself");
    expect(text).toContain("No rate difference on this loss.");
  });
});

// ---------------------------------------------------------------------------
// Adapter — reads the pipeline's own finding objects
// ---------------------------------------------------------------------------

function detectorFinding(overrides: Partial<CitationDensityFinding> & { id: string; operationLabel: string }): CitationDensityFinding {
  return {
    category: "other",
    estimateGapType: "missing_from_carrier",
    impact: { dollarImpact: null, laborHoursImpact: null, safetyImpact: "low", supplementPriority: "medium" },
    citationStatus: {
      oem: "needed", pPages: "needed", scrs: "needed", deg: "needed", nhtsa: "needed",
      stateRegulation: "needed", policy: "needed", invoiceOrCompletionProof: "needed", photoOrTeardownProof: "needed",
    },
    citationDensityScore: 40,
    verifiedAuthorityCount: 0,
    missingAuthorityTypes: [],
    currentSupportSummary: "",
    missingProofSummary: "",
    recommendedNextAction: "",
    confidence: "medium",
    limitations: [],
    ...overrides,
  } as CitationDensityFinding;
}

const reconciliation = buildForensicReconciliation({
  higherTotals: {
    categories: [
      { category: "Parts", hours: null, rate: null, cost: 11589.41 },
      { category: "Body Labor", hours: 77.0, rate: 75, cost: 5775.0 },
      { category: "Paint Labor", hours: 44.6, rate: 75, cost: 3345.0 },
      { category: "Paint Supplies", hours: 44.6, rate: 60, cost: 2676.0 },
      { category: "Miscellaneous", hours: null, rate: null, cost: 1427.21 },
    ],
    subtotal: 24812.62, salesTax: 1452.58, grandTotal: 26265.2, taxLanes: [{ label: "Sales Tax", amount: 1452.58 }],
  },
  lowerTotals: {
    categories: [
      { category: "Parts", hours: null, rate: null, cost: 5130.05 },
      { category: "Body Labor", hours: 59.0, rate: 60, cost: 3540.0 },
      { category: "Paint Labor", hours: 26.0, rate: 60, cost: 1560.0 },
      { category: "Paint Supplies", hours: 26.0, rate: 39, cost: 1014.0 },
      { category: "Miscellaneous", hours: null, rate: null, cost: 183.99 },
    ],
    subtotal: 11428.04, salesTax: 685.68, grandTotal: 12113.72, taxLanes: [{ label: "Sales Tax", amount: 685.68 }],
  },
});

const findings: CitationDensityFinding[] = [
  detectorFinding({
    id: "required-detector-delta-missing-operation-rt-fender-ln-35",
    operationLabel: "Missing from comparison estimate: RT Fender",
    shopEvidence: { lineNumber: "35", description: "RT Fender", amount: 905.0, laborHours: 2.3 },
    impact: { dollarImpact: 905.0, laborHoursImpact: 2.3, safetyImpact: "low", supplementPriority: "high" },
    currentSupportSummary:
      "Delta category: missing operation. Annotated estimate (higher-cost): Shop.pdf page 2 line 35: 35 Repl RT Fender 905.00 2.3 2.4. Comparison estimate (lower-cost): not present on SOR-1.pdf. Amount delta: $905.00. Labor delta: 2.3 hours. Paint delta: 2.4 hours. Pairing basis: none.",
  }),
  detectorFinding({
    id: "required-detector-delta-missing-operation-blnd-rt-ctr-plr-rocker-ln-78",
    operationLabel: "Missing from comparison estimate: Blnd RT Ctr plr & rocker",
    category: "refinish",
    shopEvidence: { lineNumber: "78", description: "Blnd RT Ctr plr & rocker", amount: null, laborHours: null },
    impact: { dollarImpact: null, laborHoursImpact: null, safetyImpact: "low", supplementPriority: "medium" },
    currentSupportSummary:
      "Delta category: missing operation. Annotated estimate (higher-cost): Shop.pdf page 4 line 78: 78 Blnd RT Ctr plr & rocker 3.6. Comparison estimate (lower-cost): not present on SOR-1.pdf. Amount delta: not quantified. Labor delta: not quantified hours. Paint delta: 3.6 hours. Pairing basis: none.",
  }),
  detectorFinding({
    id: "required-detector-delta-missing-operation-post-repair-scan-34-ln-198",
    operationLabel: "Missing from comparison estimate: Post-repair scan +34%",
    category: "scan_diagnostic",
    shopEvidence: { lineNumber: "198", description: "Post-repair scan +34%", amount: 0.01, laborHours: null },
    impact: { dollarImpact: 0.01, laborHoursImpact: null, safetyImpact: "high", supplementPriority: "high" },
  }),
  detectorFinding({
    id: "required-detector-delta-part-price-pre-repair-scan-34-ln-188",
    operationLabel: "Priced differently on comparison estimate: Pre-repair scan +34%",
    category: "scan_diagnostic",
    estimateGapType: "present_but_under_documented",
    shopEvidence: { lineNumber: "188", description: "Pre-repair scan +34%", amount: 201.0, laborHours: null },
    impact: { dollarImpact: 201.0, laborHoursImpact: -0.5, safetyImpact: "high", supplementPriority: "high" },
    currentSupportSummary:
      "Delta category: price difference. Annotated estimate (higher-cost): Shop.pdf page 9 line 188: 188 Pre-repair scan +34% 201.00. Comparison estimate (lower-cost): SOR-1.pdf page 5 line 107: 107 Pre-repair scan 0.00 0.5. Amount delta: $201.00. Labor delta: -0.5 hours. Paint delta: not quantified hours. Pairing basis: description.",
  }),
  detectorFinding({
    id: "required-detector-delta-reduced-labor-o-h-bumper-assy-ln-6",
    operationLabel: "Comparison estimate allows less body labor: O/H bumper assy",
    category: "labor_difference",
    estimateGapType: "reduced_by_carrier",
    shopEvidence: { lineNumber: "6", description: "O/H bumper assy", amount: null, laborHours: 9.6 },
    impact: { dollarImpact: null, laborHoursImpact: 8.1, safetyImpact: "low", supplementPriority: "medium" },
  }),
  detectorFinding({
    id: "required-detector-totals-rate-difference-body-labor-totals-1",
    operationLabel: "Rate difference: Body Labor",
    category: "labor_difference",
    estimateGapType: "needs_proof",
  }),
  detectorFinding({
    id: "required-detector-totals-lower-only-lines-totals-9",
    operationLabel: "Lines only on the lower estimate (47)",
    estimateGapType: "needs_proof",
    currentSupportSummary:
      "SOR-1.pdf carries 47 line(s) with no counterpart on this estimate: [FRONT DOOR] LKQ Mirror assy ($406.25 + 0.7 hr); [FENDER] A/M Wheel opng mldg ($88.10); [FENDER] CAPA Fender ($252.50 + 2.3 hr); [WHEELS] Recond Wheel ($310.00) …and 43 more. Additionally, 2 lower-estimate line(s) repeat the description of a line already matched: [BUMPER] Overlap ($0.00).",
  }),
  detectorFinding({
    id: "required-detector-sand_polish_p_page_support-ln-208",
    operationLabel: "Refinish database support review: Finish sand & polish (0.5 Refinish)",
    category: "refinish",
    estimateGapType: "needs_proof",
    shopEvidence: { lineNumber: "208", description: "Finish sand & polish", amount: null, laborHours: null },
  }),
  detectorFinding({
    id: "required-detector-delta-carrier-higher-subl-alignment-ln-61",
    operationLabel: "Comparison estimate allows MORE here: Four wheel alignment",
    estimateGapType: "present_but_under_documented",
    shopEvidence: { lineNumber: "61", description: "Four wheel alignment", amount: 0, laborHours: null },
    impact: { dollarImpact: 268.0, laborHoursImpact: null, safetyImpact: "low", supplementPriority: "medium" },
  }),
];

const findingNumbers = new Map(findings.map((finding, index) => [finding.id, index + 1]));

describe("the adapter reads the Forensic report's own inputs", () => {
  const adapted = adaptForensicToPlainSummary({
    reconciliation,
    findings,
    findingNumbers,
    higherDocumentName: "Shop Post-TD 22264.pdf",
    lowerDocumentName: "SOR-1 22264.pdf",
    lowerDocumentLabel: "Coast National",
    higherLineCount: 171,
    lowerLineCount: 98,
    noCounterpartRows: Array.from({ length: 107 }, (_, i) => ({ line: i + 1, description: `Line ${i + 1}`, amount: null })),
    vehicleLabel: "2023 Audi Q5 45 S Line Prestige",
    roNumber: "22264",
    identity: [{ label: "Vehicle", value: "2023 Audi Q5 45 S Line Prestige" }, { label: "RO number", value: "22264" }],
    generatedAt: "2026-09-17T14:05:00.000Z",
  });

  it("maps the reconciliation rows onto the five buckets with hours and rates intact", () => {
    expect(adapted.ok).toBe(true);
    if (!adapted.ok) return;
    const totals = adapted.input.docA.totals;
    expect(totals.parts).toBe(11589.41);
    expect(totals.bodyLabor).toEqual({ hours: 77.0, rate: 75, total: 5775.0 });
    expect(totals.paintSupplies).toEqual({ hours: 44.6, rate: 60, total: 2676.0 });
    expect(totals.tax).toBe(1452.58);
    expect(totals.total).toBe(26265.2);
    expect(adapted.input.docB.totals.paintSupplies).toEqual({ hours: 26.0, rate: 39, total: 1014.0 });
    expect(adapted.input.missingLineCount).toBe(107);
    expect(adapted.input.preparedDate).toBe("2026-09-17");
    expect(adapted.input.roNumber).toBe("22264");
    const built = buildPlainSummaryModel(adapted.input);
    expect(built.header.gap).toBe(14151.48);
    expect(built.rateEffect?.total).toBe(2760.6);
  });

  it("classifies findings by the detector's own ids and keeps the badge numbers", () => {
    if (!adapted.ok) throw new Error("adapter refused");
    const byTitle = new Map(adapted.input.findings.map((f) => [f.title, f]));
    expect(byTitle.get("RT Fender")).toMatchObject({
      id: 1, category: "missing_operation", section: "other", lineA: 35, amountDelta: 905.0, laborDelta: 2.3, paintDelta: 2.4, priceA: 905.0,
    });
    expect(byTitle.get("Blnd RT Ctr plr & rocker")).toMatchObject({ category: "missing_operation", section: "refinish", paintDelta: 3.6 });
    expect(byTitle.get("Post-repair scan +34%")).toMatchObject({ category: "missing_operation", section: "adas", priceA: 0.01 });
    expect(byTitle.get("Pre-repair scan +34%")).toMatchObject({ category: "part_or_price_difference", section: "adas", priceA: 201.0, priceB: 0 });
    expect(byTitle.get("O/H bumper assy")).toMatchObject({ id: 5, category: "reduced_labor", laborDelta: 8.1 });
    expect(byTitle.get("Body Labor")).toMatchObject({ category: "rate_difference" });
    expect(byTitle.get("Lines only on the lower estimate (47)")).toMatchObject({
      category: "lower_only_lines",
      lowerOnlyCount: 47,
      lowerOnlySamples: ["[FRONT DOOR] LKQ Mirror assy ($406.25 + 0.7 hr)", "[FENDER] A/M Wheel opng mldg ($88.10)", "[FENDER] CAPA Fender ($252.50 + 2.3 hr)", "[WHEELS] Recond Wheel ($310.00)"],
    });
    expect(byTitle.get("Finish sand & polish (0.5 Refinish)")).toMatchObject({ category: "support_review", lineA: 208 });
    // A comparison-allows-more finding has no place in a document about what
    // the comparison left off; it is not miscounted as a missing operation.
    expect(byTitle.has("Four wheel alignment")).toBe(false);
  });

  it("the model built from adapted findings surfaces the same lines the fixture does", () => {
    if (!adapted.ok) throw new Error("adapter refused");
    const built = buildPlainSummaryModel(adapted.input);
    expect(built.parts.top[0].title).toBe("RT Fender");
    expect(built.paintHours[0]).toMatchObject({ title: "Blnd RT Ctr plr & rocker", hours: 3.6 });
    expect(built.adas.placeholders).toHaveLength(1);
    expect(built.adas.scanPriceDiff?.title).toBe("Pre-repair scan +34%");
    expect(built.bumperOverhaul?.id).toBe(5);
    expect(built.lowerOnlyCount).toBe(47);
    expect(built.supportReview).toHaveLength(1);
    const text = plainSummaryDocumentText(buildPlainSummaryDocument(built));
    expect(text).toContain("Their sheet has [FRONT DOOR] LKQ Mirror assy ($406.25 + 0.7 hr)");
    expect(findBannedPhrases(text)).toEqual([]);
  });

  it("applies the run's redaction policy to document names and finding titles", () => {
    const scrubbed = adaptForensicToPlainSummary({
      reconciliation,
      findings,
      findingNumbers,
      higherDocumentName: "Shop Post-TD 22264.pdf",
      lowerDocumentName: "GEICO SOR-1 22264.pdf",
      higherLineCount: 171,
      lowerLineCount: 98,
      noCounterpartRows: [],
      vehicleLabel: "2023 Audi Q5",
      generatedAt: "2026-09-17T14:05:00.000Z",
      scrub: (value) => value.replace(/GEICO/g, "[REDACTED]"),
    });
    expect(scrubbed.ok).toBe(true);
    if (!scrubbed.ok) return;
    expect(scrubbed.input.docB.title).toBe("[REDACTED] SOR-1 22264.pdf");
  });

  it("an unnumbered finding stays unnumbered rather than being given a badge", () => {
    const partial = adaptForensicToPlainSummary({
      reconciliation,
      findings,
      findingNumbers: new Map([[findings[0].id, 12]]),
      higherDocumentName: "A.pdf",
      lowerDocumentName: "B.pdf",
      higherLineCount: null,
      lowerLineCount: null,
      noCounterpartRows: [],
      vehicleLabel: null,
      generatedAt: "2026-09-17T14:05:00.000Z",
    });
    if (!partial.ok) throw new Error("adapter refused");
    expect(partial.input.findings.find((f) => f.title === "RT Fender")?.id).toBe(12);
    expect(partial.input.findings.find((f) => f.title === "O/H bumper assy")?.id).toBe(0);
    const text = plainSummaryDocumentText(buildPlainSummaryDocument(buildPlainSummaryModel(partial.input)));
    expect(text).toContain("O/H bumper assy. The report flags it");
    expect(text).not.toMatch(/Finding 0\b/);
    expect(text).toContain("Vehicle not identified on the documents");
  });

  it("refuses when a grand total could not be read, and when the annotated estimate is not the higher one", () => {
    const noTotal = adaptForensicToPlainSummary({
      reconciliation: { ...reconciliation, lowerGrandTotal: null },
      findings: [],
      higherDocumentName: "A.pdf",
      lowerDocumentName: "B.pdf",
      higherLineCount: null,
      lowerLineCount: null,
      noCounterpartRows: [],
      vehicleLabel: null,
      generatedAt: "2026-09-17T14:05:00.000Z",
    });
    expect(noTotal).toEqual({ ok: false, reason: expect.stringMatching(/grand totals could not be read/) });

    const inverted = adaptForensicToPlainSummary({
      reconciliation: { ...reconciliation, higherGrandTotal: 12113.72, lowerGrandTotal: 26265.2 },
      findings: [],
      higherDocumentName: "A.pdf",
      lowerDocumentName: "B.pdf",
      higherLineCount: null,
      lowerLineCount: null,
      noCounterpartRows: [],
      vehicleLabel: null,
      generatedAt: "2026-09-17T14:05:00.000Z",
    });
    expect(inverted).toEqual({ ok: false, reason: expect.stringMatching(/not the higher/) });
  });

  it("a category printed on one document only is zero only when the other document reconciles", () => {
    const withMechanical = buildForensicReconciliation({
      higherTotals: {
        categories: [
          { category: "Parts", hours: null, rate: null, cost: 1000 },
          { category: "Body Labor", hours: 10, rate: 75, cost: 750 },
          { category: "Mechanical Labor", hours: 2, rate: 110, cost: 220 },
        ],
        subtotal: 1970, salesTax: 100, grandTotal: 2070, taxLanes: [],
      },
      lowerTotals: {
        categories: [
          { category: "Parts", hours: null, rate: null, cost: 800 },
          { category: "Body Labor", hours: 8, rate: 60, cost: 480 },
        ],
        subtotal: 1280, salesTax: 60, grandTotal: 1340, taxLanes: [],
      },
    });
    const adaptedMech = adaptForensicToPlainSummary({
      reconciliation: withMechanical,
      findings: [],
      higherDocumentName: "A.pdf",
      lowerDocumentName: "B.pdf",
      higherLineCount: null,
      lowerLineCount: null,
      noCounterpartRows: [],
      vehicleLabel: null,
      generatedAt: "2026-09-17T14:05:00.000Z",
    });
    if (!adaptedMech.ok) throw new Error("adapter refused");
    // The lower document's categories sum to its subtotal, so its missing
    // mechanical row is a legitimate zero and the bucket reconciles.
    expect(adaptedMech.input.docA.totals.other).toEqual({ label: "Other categories (Mechanical Labor)", total: 220 });
    expect(adaptedMech.input.docB.totals.other).toEqual({ label: "Other categories (Mechanical Labor)", total: 0 });
    expect(adaptedMech.input.docA.totals.paintLabor).toBeNull();
    expect(adaptedMech.input.unpricedCategories).toEqual([]);
    const built = buildPlainSummaryModel(adaptedMech.input);
    expect(built.buckets.map((b) => b.key)).toEqual(["parts", "bodyLabor", "other", "tax", "total"]);
    expect(built.buckets.find((b) => b.key === "other")!.gap).toBe(220);
  });
});
