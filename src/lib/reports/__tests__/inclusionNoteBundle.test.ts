/**
 * A carrier's diagnostic bundle line whose own note names the work it
 * includes: "<Maker> Tool Box" 1.0 M, noted "(includes pre and post and 1
 * Calibration and Service Mode)", with the carrier's 0.0 hr pre- and
 * post-repair scan lines each noted "Included in <Maker> tool Box".
 *
 * The reports read it four wrong ways: the two-word "Tool Box" was not
 * recognized as a diagnostic line, so the bundle read as "on this estimate
 * only" and every step of ours it names as "not on this estimate"; the
 * scans the matcher had paired with the 0.0 hr lines were never allocated to
 * the bundle, so a "Pre / post repair scans … no hours or price" entry
 * contradicted the carrier's own notes; the equivalence groups took part of
 * the bundle, so the dispute report argued neither half; and a grouped entry
 * printed its hours with no category ("2.0 hr" for two 1.0 M lines).
 *
 * Lines are shaped like the prints' own (CCC ONE rows, notes on the next
 * line); names and part numbers are synthetic.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { argueItems, type MatcherPair } from "../appraisalSummary/argueItems";
import { pairsFromDeltas } from "../appraisalSummary/estimateFromDeltaRows";
import type { GapLedger } from "../appraisalSummary/gapLedger";
import { buildLowerEstimateFindings } from "../appraisalSummary/lowerEstimateFindings";
import { groupEquivalents } from "../appraisalSummary/operationEquivalence";
import { assignUnits } from "../appraisalSummary/shortPayView";
import type { Estimate, EstimateLine } from "../appraisalSummary/types";
import { buildRequiredEstimatorDeltaFindings } from "../annotatedCitationDensityEstimate";
import { buildEstimateRowAnchorsFromLines, buildPdfTextLines, type PdfWord } from "../citationDensityRowAnchors";
import { applyComparisonInclusionNotes } from "../comparisonInclusionNotes";
import type { EstimateDeltaRow, EstimateLineItemDelta } from "../estimateDeltaMatcher";
import type { PlainSummaryModel } from "../plainLanguageSummary";
import { adaptForensicToPlainSummary } from "../plainLanguageSummaryAdapter";
import { buildPlainSummaryModel } from "../plainLanguageSummary";

const BUNDLE_NOTE = "(includes pre and post and 1 Calibration and Service Mode)";

const row = (
  line: number,
  description: string,
  labor: number | null,
  laborType: string | null = "M",
  section = "VEHICLE DIAGNOSTICS"
): EstimateDeltaRow => ({
  lineNumber: line,
  opCode: null,
  description,
  descriptionTokens: description.toLowerCase().split(/\W+/).filter(Boolean),
  partNumber: null,
  section,
  qty: null,
  price: null,
  labor,
  laborIncluded: false,
  paint: null,
  paintIncluded: false,
  laborType,
  rawText: `${line} ${description}`,
});
const missing = (higherRow: EstimateDeltaRow): EstimateLineItemDelta => ({
  kind: "missing_operation",
  lowerRow: null,
  higherRow,
  matchBasis: "none",
  laborDelta: higherRow.labor,
  paintDelta: null,
  priceDelta: null,
  summary: `Higher estimate documents "${higherRow.description}"; not present on the lower estimate.`,
  annotate: true,
});
const reduced = (higherRow: EstimateDeltaRow, lowerRow: EstimateDeltaRow): EstimateLineItemDelta => ({
  kind: "reduced_labor",
  lowerRow,
  higherRow,
  matchBasis: "description",
  laborDelta: (higherRow.labor ?? 0) - (lowerRow.labor ?? 0),
  paintDelta: null,
  priceDelta: null,
  summary: `${higherRow.description}: labor ${higherRow.labor} vs ${lowerRow.labor}`,
  annotate: true,
});

/** A CCC text layer: each row as printed, its note on the next line. */
const cccText = (rows: Array<[string, string?]>, section = "VEHICLE DIAGNOSTICS") =>
  [
    "Workfile ID: 0a1b2c3d",
    "Line Oper Description",
    // Row numbers climb from the top of the sheet, as CCC prints them.
    "10 FRONT BUMPER",
    "30 HOOD",
    `40 ${section}`,
    ...rows.flatMap(([printed, note]) => (note ? [printed, `NOTE: ${note}`] : [printed])),
    "SUBTOTALS",
  ].join("\n");

// ---------------------------------------------------------------------------
// (a) Which carrier line is a diagnostic bundle, and what its note names
// ---------------------------------------------------------------------------

describe("a diagnostic bundle written as two words, or under a diagnostic section, is recognized", () => {
  const ours = () => [missing(row(69, 'Place vehicle in "Service Mode"', 0.1)), missing(row(73, "Set up & initiate camera", 1.0))];

  it("'Tool Box' in VEHICLE DIAGNOSTICS takes the work its note names", () => {
    const bundle = row(46, "S02 Rpr Maker Tool Box", 1.0);
    const result = applyComparisonInclusionNotes({
      deltas: ours(),
      lowerOnlyRows: [bundle],
      comparisonText: cccText([["46*S02  Rpr  Maker Tool Box00.00m1.0M0.0", BUNDLE_NOTE]]),
      comparisonName: "SOR.pdf",
    });
    expect(result.lowerOnlyRows).toEqual([]);
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0]).toMatchObject({ kind: "reduced_labor", lowerRow: bundle, coveredHigherLines: [69, 73] });
  });

  it("a line printed in a diagnostic section qualifies by its section, whatever it is called", () => {
    const bundle = row(46, "S02 Rpr Maker service package", 1.0);
    const result = applyComparisonInclusionNotes({
      deltas: ours(),
      lowerOnlyRows: [bundle],
      comparisonText: cccText([["46*S02  Rpr  Maker service package00.00m1.0M0.0", BUNDLE_NOTE]]),
      comparisonName: "SOR.pdf",
    });
    expect(result.coverage.map((c) => c.lowerRow.lineNumber)).toEqual([46]);
  });

  it("'includes pre-drilled holes' names no scan: our pre-repair scan stays as the matcher read it", () => {
    const deltas = [missing(row(68, "Pre-repair scan", 1.0))];
    const bracket = row(42, "S01 Repl Scan tool bracket", 0.3, null, "PICKUP BOX");
    const result = applyComparisonInclusionNotes({
      deltas,
      lowerOnlyRows: [bracket],
      comparisonText: cccText([["42 S01  Repl  Scan tool bracket10.000.30.0", "(includes pre-drilled holes)"]], "PICKUP BOX"),
      comparisonName: "SOR.pdf",
    });
    expect(result.coverage).toEqual([]);
    expect(result.deltas).toEqual(deltas);
    expect(result.lowerOnlyRows).toEqual([bracket]);
  });

  it("a truck-bed tool box outside a diagnostic section, noting its hardware, changes nothing", () => {
    const deltas = [missing(row(68, "Pre-repair scan", 1.0))];
    const box = row(42, "S01 Repl Tool box", 0.5, null, "PICKUP BOX");
    const result = applyComparisonInclusionNotes({
      deltas,
      lowerOnlyRows: [box],
      comparisonText: cccText([["42 S01  Repl  Tool box1250.000.50.0", "(includes mounting hardware)"]], "PICKUP BOX"),
      comparisonName: "SOR.pdf",
    });
    expect(result.coverage).toEqual([]);
    expect(result.deltas).toEqual(deltas);
  });
});

// ---------------------------------------------------------------------------
// (b) One allocation: the carrier lines whose notes point back join the bundle
// ---------------------------------------------------------------------------

describe("carrier lines whose own note says 'Included in <bundle>' join its one comparison", () => {
  const pre = row(45, "S01 Rpr Pre-repair scan", 0, null);
  const bundle = row(46, "S02 Rpr Maker Tool Box", 1.0);
  const post = row(47, "S01 Rpr Post-repair scan", 0, null);
  const text = (preNote: string, postNote: string) =>
    cccText([
      ["45*S01  Rpr  Pre-repair scan00.00m0.00.0", preNote],
      ["46*S02  Rpr  Maker Tool Box00.00m1.0M0.0", BUNDLE_NOTE],
      ["47*S01  Rpr  Post-repair scan00.00m0.00.0", postNote],
    ]);
  const deltas = () => [
    // The matcher paired our pre-repair scan with their 0.0 hr line.
    reduced(row(68, "Pre-repair scan", 1.0), pre),
    missing(row(69, 'Place vehicle in "Service Mode"', 0.1)),
    missing(row(72, "In-Proc repair scan", 1.0)),
    missing(row(73, "Set up & initiate camera", 1.0)),
    missing(row(76, "Drive time for camera calibration procedure", 1.0)),
    missing(row(77, "Post-repair scan", 1.0)),
    missing(row(79, 'Remove vehicle from "Service Mode"', 0.1)),
  ];

  it("paired or one-sided, each is compared once with the bundle, and the note's limits are stated", () => {
    const result = applyComparisonInclusionNotes({
      deltas: deltas(),
      // Their post-repair scan line paired with nothing.
      lowerOnlyRows: [bundle, post],
      comparisonText: text("Included in Maker tool Box", "Included in Maker tool Box"),
      comparisonName: "SOR.pdf",
    });
    expect(result.lowerOnlyRows).toEqual([]);
    // In-process scanning is not work the note names: it stays assessed on its own.
    expect(result.deltas.filter((d) => d.statusLabels?.includes("COVERED_BY_COMPARISON_NOTE") !== true).map((d) => d.higherRow.lineNumber)).toEqual([72]);
    const covered = result.deltas.find((d) => d.statusLabels?.includes("COVERED_BY_COMPARISON_NOTE"));
    expect(covered).toMatchObject({
      lowerRow: bundle,
      coveredHigherLines: [68, 69, 73, 76, 77, 79],
      coveredLowerLines: [45, 47],
      coveredByInferenceLines: [76, 79],
      laborDelta: 3.2,
    });
    // Five of the six were reported missing; the paired scan was not.
    expect(result.coverage[0].missingCount).toBe(5);
    expect(covered?.summary).toContain('On SOR.pdf, L45, L47 print 0.0 hr, each noted "Included in Maker tool Box".');
    expect(covered?.summary).toContain("The note's words name the work on L68, L69, L73, L77; L76, L79 are counted with it by inference only");
    expect(covered?.summary).toContain("The note does not say how its 1.0 hr divides among these steps or that each step is paid.");
    expect(covered?.summary).not.toMatch(/\bpays\b/);
    // The dispute layer receives the whole comparison as one pair.
    expect(pairsFromDeltas(result.deltas)).toContainEqual({
      kind: "reduced",
      shopLines: [68, 69, 73, 76, 77, 79],
      carrierLine: 46,
      coveredByCarrierNote: true,
      coveredCarrierLines: [45, 47],
      inferredShopLines: [76, 79],
    });
  });

  it("a note naming something else, or too short to name anything, points nowhere", () => {
    const result = applyComparisonInclusionNotes({
      deltas: deltas(),
      lowerOnlyRows: [bundle, post],
      comparisonText: text("Included in labor", "Included in Maker diagnostic package"),
      comparisonName: "SOR.pdf",
    });
    const covered = result.deltas.find((d) => d.statusLabels?.includes("COVERED_BY_COMPARISON_NOTE"));
    expect(covered?.coveredLowerLines).toBeUndefined();
    // The paired scan stays paired, and their unpaired line stays theirs alone.
    expect(result.deltas.find((d) => d.higherRow.lineNumber === 68)?.lowerRow).toBe(pre);
    expect(result.lowerOnlyRows).toEqual([post]);
  });

  it("the bundle's name is read across its wrapped print line", () => {
    const wrapped = row(46, "S03 Rpr Other diagnostic services-MAKER", 1.0);
    const result = applyComparisonInclusionNotes({
      deltas: deltas(),
      lowerOnlyRows: [wrapped],
      comparisonText: cccText([
        ["45*S01  Rpr  Pre-repair scan00.00m0.00.0", "Included in Maker Toolbox"],
        ["46*S03  Rpr  Other diagnostic services-MAKER\nTOOLBOX\n00.00m1.0M0.0", BUNDLE_NOTE],
      ]),
      comparisonName: "SOR.pdf",
    });
    expect(result.deltas.find((d) => d.lowerRow === wrapped)?.coveredLowerLines).toEqual([45]);
  });
});

describe("'1 Calibration' against our calibrations of more than one target", () => {
  it("folds none of them in, and asks which one the note includes", () => {
    const bundle = row(46, "S02 Rpr Maker Tool Box", 1.0);
    const result = applyComparisonInclusionNotes({
      deltas: [
        missing(row(68, "Pre-repair scan", 1.0)),
        missing(row(73, "Calibrate front camera", 1.0)),
        missing(row(74, "Calibrate front radar", 1.0)),
        missing(row(77, "Post-repair scan", 1.0)),
      ],
      lowerOnlyRows: [bundle],
      comparisonText: cccText([["46*S02  Rpr  Maker Tool Box00.00m1.0M0.0", "(includes pre and post and 1 Calibration)"]]),
      comparisonName: "SOR.pdf",
    });
    expect(result.deltas.find((d) => d.lowerRow === bundle)?.coveredHigherLines).toEqual([68, 77]);
    expect(result.deltas.filter((d) => d.kind === "missing_operation").map((d) => d.higherRow.lineNumber)).toEqual([73, 74]);
    expect(result.verify).toHaveLength(1);
    expect(result.verify[0]).toContain("calibration of 2 targets (camera, radar) on L73, L74");
    expect(result.verify[0]).toContain("which of them the note includes is not stated");
  });

  it("the steps of one camera calibration are that one calibration", () => {
    const bundle = row(46, "S02 Rpr Maker Tool Box", 1.0);
    const result = applyComparisonInclusionNotes({
      deltas: [missing(row(73, "Set up & initiate camera", 1.0)), missing(row(74, "Capture image & adjust cameras", 0.6))],
      lowerOnlyRows: [bundle],
      comparisonText: cccText([["46*S02  Rpr  Maker Tool Box00.00m1.0M0.0", "(includes pre and post and 1 Calibration)"]]),
      comparisonName: "SOR.pdf",
    });
    expect(result.verify).toEqual([]);
    expect(result.deltas.find((d) => d.lowerRow === bundle)?.coveredHigherLines).toEqual([73, 74]);
  });
});

// ---------------------------------------------------------------------------
// The dispute model and the lower-estimate citation copy
// ---------------------------------------------------------------------------

const estimate = (role: "shop" | "carrier", lines: EstimateLine[]): Estimate => ({
  role,
  fileName: role === "shop" ? "Shop.pdf" : "SOR.pdf",
  vehicle: "",
  totals: {
    parts: 0,
    misc: 0,
    labor: [
      { cat: "body", label: "Body Labor", hours: 10, rate: 90, cost: 900 },
      { cat: "mechanical", label: "Mechanical Labor", hours: 10, rate: 175, cost: 1750 },
    ],
    paintSupplies: { hours: 0, rate: 0, cost: 0 },
    subtotal: 0,
    tax: 0,
    grandTotal: 0,
  },
  lines,
});
const m = (line: number, desc: string, hours: number): EstimateLine => ({ line, oper: "Rpr", desc, hours, laborCat: "mechanical" });

/** The appraisal pipeline's own steps, in its order, on a model with no open reads. */
function lowerCopy(shopLines: EstimateLine[], carrierLines: EstimateLine[], pairs: MatcherPair[]) {
  const shop = estimate("shop", shopLines);
  const carrier = estimate("carrier", carrierLines);
  const { groups, usedShop } = groupEquivalents(shop, carrier, pairs);
  const items = argueItems({ shop, carrier, groups, usedShop, flags: [], pairs });
  const ledger = { paintMaterials: 0, otherMaterials: 0, laborRate: 0, shopLineRead: null } as unknown as GapLedger;
  const model = { shop, carrier, ledger, groups, items, facts: { checkFirst: [], askCarrier: [] } } as unknown as PlainSummaryModel;
  return { groups, items, units: assignUnits({ shop, carrier, ledger, groups, pairs }).units, set: buildLowerEstimateFindings(model, pairs) };
}

describe("the bundle is one unit and one argued item, on the line that prints its note", () => {
  const shopLines = [
    m(68, "Pre-repair scan", 1.0),
    m(69, 'Place vehicle in "Service Mode"', 0.1),
    m(72, "In-Proc repair scan", 1.0),
    m(73, "Set up & initiate camera calibration procedure", 1.0),
    m(76, "Drive time for camera calibration procedure", 1.0),
    m(77, "Post-repair scan", 1.0),
    m(79, 'Remove vehicle from "Service Mode"', 0.1),
  ];
  const carrierLines: EstimateLine[] = [
    { line: 45, oper: "Rpr", desc: "Pre-repair scan", note: "Included in Maker tool Box" },
    { ...m(46, "Maker Tool Box", 1.0), note: BUNDLE_NOTE },
    { line: 47, oper: "Rpr", desc: "Post-repair scan", note: "Included in Maker tool Box" },
    // Their own drive-time line: it anchors the ADAS group.
    m(50, "Drive time for camera calibration", 1.0),
  ];
  const pairs: MatcherPair[] = [
    {
      kind: "reduced",
      shopLines: [68, 69, 73, 77, 79],
      carrierLine: 46,
      coveredByCarrierNote: true,
      coveredCarrierLines: [45, 47],
      inferredShopLines: [79],
    },
    { kind: "matched", shopLines: [76], carrierLine: 50 },
    { kind: "missing", shopLines: [72] },
  ];

  it("no equivalence group takes a line of the bundle, so its argued item survives", () => {
    const { groups, items } = lowerCopy(shopLines, carrierLines, pairs);
    expect(groups.map((g) => [g.key, g.shopLines, g.carrierLines])).toEqual([["adas", [72, 76], [50]]]);
    const bundle = items.find((i) => i.title === "Maker Tool Box: the work its note includes");
    expect(bundle).toMatchObject({ shopLines: [68, 69, 73, 77, 79], carrierLines: [46, 45, 47], hours: 2.2, value: 385 });
    expect(bundle?.detail).toBe(
      'Ours 3.2 hr (L68, L69, L73, L77, L79), theirs 1.0 hr (L46), whose note reads "includes pre and post and 1 Calibration and Service Mode". ' +
        'Their L45, L47 print 0.0 hr, each noted "Included in Maker tool Box". ' +
        "The note's words name the work on our L68, L69, L73, L77; our L79 is counted with it by inference only, which the note does not state. " +
        "The note does not say how its 1.0 hr divides among these steps or that each step is paid."
    );
  });

  it("their 0.0 hr scan lines sit in the bundle's unit, never paired by words with our in-process scan", () => {
    const { units } = lowerCopy(shopLines, carrierLines, pairs);
    expect(units.find((u) => u.carrierLines.includes(45))).toMatchObject({ shopLines: [68, 69, 73, 77, 79], carrierLines: [46, 45, 47], anchorLine: 46 });
    expect(units.some((u) => u.shopLines.includes(72) && u.carrierLines.some((c) => c === 45 || c === 47))).toBe(false);
  });

  it("the citation copy states it once, on Ln 46, with every category tag", () => {
    const { set } = lowerCopy(shopLines, carrierLines, pairs);
    expect(set.findings.find((f) => f.carrierLine === 45)).toBeUndefined();
    const text = set.findings.find((f) => f.carrierLine === 46)!.entries.map((e) => e.text).join(" ");
    expect(text).toContain("Maker Tool Box (the work its note includes): ours 3.2 hr M (L68, L69, L73, L77, L79) vs this estimate's 1.0 hr M; short $385.00.");
    expect(text).toContain(`Ln 46 prints 1.0 hr M; its note reads "${BUNDLE_NOTE}".`);
    expect(text).toContain("This estimate's L45, L47 print 0.0 hr");
    expect(text).toContain("our L79 is counted with it by inference only");
    expect(text).not.toMatch(/no hours or price|on this estimate only/);
  });
});

describe("a grouped entry prints its hours per category, never one tag over mixed lines, never none", () => {
  it("two 1.0 M lines are '2.0 hr M'; 0.5 body and 0.3 M are '0.5 hr + 0.3 hr M'", () => {
    const { set } = lowerCopy(
      [m(68, "Pre-repair scan", 1.0), m(77, "Post-repair scan", 1.0)],
      [
        { line: 45, oper: "Rpr", desc: "Pre-repair scan", hours: 0.5, laborCat: "body" },
        m(47, "Post-repair scan", 0.3),
      ],
      []
    );
    const text = set.findings.flatMap((f) => f.entries.map((e) => e.text)).join(" ");
    expect(text).toContain("Pre / post repair scans: ours 2.0 hr M (L68, L77) vs this estimate's 0.5 hr + 0.3 hr M;");
  });
});

// ---------------------------------------------------------------------------
// End to end on the repository's de-identified RO 22084 fixture: the same
// bundle note, with the carrier's own drive-time and service-mode-out lines
// paid separately beside it.
// ---------------------------------------------------------------------------

describe("the fixture pair with a Tool Box note: counts, items and the forensic finding", () => {
  const FIXTURE_DIR = path.join(__dirname, "../../../../tests/fixtures/22084");
  const read = (name: string) => fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8");
  const run = () => {
    const shopText = read("shop_text.txt");
    const sorText = read("sor5_text.txt");
    const visualLines = buildPdfTextLines(JSON.parse(read("shop_words.json")) as PdfWord[]);
    const generated = buildRequiredEstimatorDeltaFindings({
      anchors: buildEstimateRowAnchorsFromLines(visualLines, { sourceDocumentRole: "shop", sourceDocumentId: "shop" }),
      visualLines,
      sourcePdfName: "Shop.pdf",
      sourceDocumentId: "shop",
      sourceDocumentRole: "shop",
      sourcePdfHash: "fixture",
      uploadedFileNames: ["Shop.pdf", "SOR.pdf"],
      sourceText: shopText,
      comparisonEstimateTexts: [{ sourceDocumentId: "sor", fileName: "SOR.pdf", text: sorText, estimateRole: "carrier" }],
      comparisonEstimateWords: [
        { fileName: "SOR.pdf", estimateRole: "carrier", words: JSON.parse(read("sor5_words.json")) as PdfWord[], textLayerReliable: true },
      ],
      extractionWarnings: [],
    });
    return { generated, shopText, sorText };
  };

  it("the bundle covers the steps its note names; each document's operation count is unchanged", () => {
    const { generated, shopText, sorText } = run();
    const forensic = generated.forensic!;
    // The operations each sheet prints, as before the note grouped some of them.
    // (132/109 since the row-prefix fix: shop Rpr and R&I trunk lid now pair
    // with the carrier's own Rpr and R&I lines instead of one aggregated
    // "2x vs 1x" pair and a test fit paired with an R&I. The count is taken
    // before coverage, so the note grouping lines changes nothing here.)
    expect([forensic.higherLineCount, forensic.lowerLineCount]).toEqual([132, 109]);
    const covered = forensic.rows.deltas.find((d) => d.statusLabels?.includes("COVERED_BY_COMPARISON_NOTE"));
    expect(covered).toMatchObject({ lowerRow: expect.objectContaining({ lineNumber: 100 }), coveredHigherLines: [137, 138, 141, 142, 143, 145] });
    expect(forensic.noCounterpartRows.map((r) => r.line)).not.toEqual(expect.arrayContaining([137]));

    const adapted = adaptForensicToPlainSummary({
      reconciliation: forensic.reconciliation,
      rows: forensic.rows,
      higherDocumentName: "Shop.pdf",
      lowerDocumentName: "SOR.pdf",
      higherText: shopText,
      lowerText: sorText,
      vehicleLabel: null,
      generatedAt: "2026-01-01T00:00:00Z",
    });
    if (!adapted.ok) throw new Error(adapted.reason);
    const model = buildPlainSummaryModel(adapted.input);
    // Their drive time (L102) still anchors the ADAS group, without the bundle's lines.
    expect(model.groups.find((g) => g.key === "adas")).toMatchObject({ shopLines: [140, 144, 146, 147], carrierLines: [102] });
    const bundle = model.items.find((i) => /Tool Box: the work its note includes/.test(i.title));
    expect(bundle).toMatchObject({ shopLines: [137, 138, 141, 142, 143, 145], carrierLines: [100], value: 525 });
    // Nothing the bundle covers is argued again as having no counterpart.
    expect(model.items.filter((i) => /No counterpart/.test(i.detail) && i.shopLines.some((l) => [137, 138, 141, 142, 143, 145].includes(l)))).toEqual([]);
    expect(model.shortPay?.gap).toBe(2226.18);
  });
});

describe("a carrier-only line whose own note places its time elsewhere is quoted", () => {
  // RO 22120 review: the carrier's R&I upper cover (0.8 hr) prints "Time is
  // after bumper cover is removed. Time included with overhaul." beside our
  // bumper overhaul; "Not on ours" alone read as work we left out.
  const body = (line: number, oper: string, desc: string, hours: number, note?: string): EstimateLine => ({
    line, oper, desc, hours, laborCat: "body", ...(note ? { note } : {}),
  });
  const entryFor = (set: ReturnType<typeof lowerCopy>["set"], carrierLine: number) =>
    set.findings.find((f) => f.carrierLine === carrierLine)!.entries.map((e) => e.text).join(" ");

  it("quotes the inclusion note once, decimals intact, and says it is not a line on ours", () => {
    const repeated = "Time 0.3 hr is included with overhaul. Time 0.3 hr is included with overhaul.";
    const { set } = lowerCopy(
      [body(56, "O/H", "Bumper assy", 3.7)],
      [
        body(38, "R&I", "LT Upper cover", 0.8, "Time is after bumper cover is removed. Time included with overhaul."),
        body(40, "R&I", "Tow bracket cover", 0.3, repeated),
      ],
      []
    );
    expect(entryFor(set, 38)).toBe(
      'LT Upper cover (0.8 hr): on this estimate only, $72.00; not a line on ours. Its note reads "Time is after bumper cover is removed. Time included with overhaul."'
    );
    expect(entryFor(set, 40)).toMatch(/Its note reads "Time 0\.3 hr is included with overhaul\."$/);
  });

  it("a carrier-only line without an inclusion note keeps the plain wording", () => {
    const { set } = lowerCopy([body(56, "O/H", "Bumper assy", 3.7)], [body(42, "R&I", "Bumper cover", 1.7, "Time is after moldings are removed.")], []);
    expect(entryFor(set, 42)).toBe("Bumper cover (1.7 hr): on this estimate only, $153.00. Not on ours.");
  });
});
