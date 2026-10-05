/**
 * RO 21548 — accuracy review of the three Delta reports (shop preliminary vs
 * a carrier Supplement of Record 3). The totals tied to the cent; the
 * line-level comparison did not. Each block below pins one defect the review
 * found, on lines shaped like the pair's own (no names, no claim data).
 */
import { describe, expect, it } from "vitest";
import { argueItems } from "../appraisalSummary/argueItems";
import { pairsFromDeltas, userCategoriesByDigit } from "../appraisalSummary/estimateFromDeltaRows";
import { shopLineRate } from "../appraisalSummary/gapLedger";
import { catTag } from "../appraisalSummary/lowerEstimateFindings";
import { groupEquivalents } from "../appraisalSummary/operationEquivalence";
import type { Estimate, EstimateLine } from "../appraisalSummary/types";
import { applyComparisonInclusionNotes } from "../comparisonInclusionNotes";
import { pairAndCompare } from "../deltaEngine/deltaPair";
import { canonKey } from "../deltaEngine/estimateNormalize";
import type { EstimateRow } from "../deltaEngine/rowCluster";
import {
  laborTypeNoun,
  reconcileMissingClaimsAgainstTotals,
  type EstimateDeltaRow,
  type EstimateLineItemDelta,
} from "../estimateDeltaMatcher";

const estimate = (role: "shop" | "carrier", lines: EstimateLine[]): Estimate => ({
  role,
  fileName: role === "shop" ? "Shop.pdf" : "SOR.pdf",
  vehicle: "",
  totals: {
    parts: 0,
    misc: 0,
    labor: [
      { cat: "body", label: "Body Labor", hours: 12.2, rate: 90, cost: 1098 },
      { cat: "mechanical", label: "Mechanical Labor", hours: 3.2, rate: 175, cost: 560 },
    ],
    paintSupplies: { hours: 0, rate: 0, cost: 0 },
    subtotal: 0,
    tax: 0,
    grandTotal: 0,
  },
  lines,
});
const argue = (shop: EstimateLine[], carrier: EstimateLine[]) =>
  argueItems({ shop: estimate("shop", shop), carrier: estimate("carrier", carrier), groups: [], usedShop: new Set(), flags: [], pairs: [] });

describe("the tire rule reads a tire written by its size, and only a wheel as what it mounts on", () => {
  const ourTires: EstimateLine[] = [
    { line: 50, oper: "Repl", desc: 'RT/Front Wheel, alloy 19" sonic silver', price: 761.48, hours: 0.3, laborCat: "mechanical" },
    { line: 53, oper: "Repl", desc: "RT/Front Westlake SA07 Sport Priority Tire 255/45R19 100V +34%", price: 172.47 },
    { line: 56, oper: "", desc: 'Mount & road force balance wheel & tire (18" to 20")', price: 75 },
    { line: 57, oper: "", desc: "Tire Disposal (Car)", price: 6 },
  ];
  const theirWheelArea: EstimateLine[] = [
    { line: 32, oper: "Repl", desc: "A/M RT Wheel opng mldg", price: 73.88, hours: 0.5, laborCat: "body", partSource: ["A/M"] },
    { line: 37, oper: "Repl", desc: "LT Wheel opng mldg", price: 100.93, hours: 0.5, laborCat: "body" },
    { line: 42, oper: "Repl", desc: "RT/Front Wheel cover silver", price: 35 },
    { line: 43, oper: "Subl", desc: 'RT/Front Wheel, alloy 19" sonic silver', price: 189.99 },
    { line: 44, oper: "Subl", desc: "Tire Mount and Balance", price: 25 },
    { line: 63, oper: "Subl", desc: "Tire Disposal Fee", price: 2.5 },
  ];
  const theirTire: EstimateLine = { line: 45, oper: "Repl", desc: "Rt Frnt Westlake SA07 Sport 255/45r19 100v +25%", price: 159.69 };

  it("a carrier tire line with no word 'tire' is still their tire: no 'they pay no tires' item", () => {
    const items = argue(ourTires, [...theirWheelArea, theirTire]);
    expect(items.some((item) => /^Tires/.test(item.title))).toBe(false);
  });

  it("wheel opening moldings and a wheel cover are not the parts a tire mounts on", () => {
    const items = argue(ourTires, theirWheelArea);
    expect(items.some((item) => /^Tires/.test(item.title))).toBe(false);
  });

  it("a carrier that replaces the wheel and writes no tire is still the STRONG item, citing the wheel", () => {
    const wheel: EstimateLine = { line: 43, oper: "Repl", desc: 'RT/Front Wheel, alloy 19" sonic silver', price: 761.48 };
    const items = argue(ourTires, [...theirWheelArea.filter((l) => l.line !== 43), wheel]);
    const tires = items.find((item) => /^Tires/.test(item.title));
    expect(tires).toMatchObject({ strength: "Strong" });
    expect(tires?.detail).toContain("(L43)");
    expect(tires?.detail).not.toMatch(/L32|L37|L42/);
  });
});

// ---------------------------------------------------------------------------
// The matcher: what pairs, and what one carrier line's own note covers.
// ---------------------------------------------------------------------------

const engineRow = (line: number, rawDesc: string, values: Partial<Pick<EstimateRow, "price" | "labor" | "paint" | "laborClass">> = {}): EstimateRow => {
  const canon = canonKey(rawDesc);
  return {
    page: 1,
    line,
    section: "",
    qty: null,
    price: values.price ?? null,
    labor: values.labor ?? null,
    paint: values.paint ?? null,
    laborClass: values.laborClass ?? "",
    part: null,
    rawDesc,
    key: canon.key,
    side: canon.side,
    cells: {},
  };
};
const pairsOf = (subject: EstimateRow[], competing: EstimateRow[]) =>
  pairAndCompare(subject, competing).pairs.map((pair) => `${pair.subject.line}-${pair.competing.line}`);

describe("the line matcher pairs on content words, never on the operation code", () => {
  it("'Rpr Set up & initiate camera' is not the carrier's 'Rpr Set Back Wiring'; our set-back line is", () => {
    const pairs = pairsOf(
      [engineRow(21, "# Set back, secure Protect wiring & connectors", { price: 2.5, labor: 0.3 }), engineRow(71, "# Rpr Set up & initiate camera", { labor: 1.0, laborClass: "3" })],
      [engineRow(61, "# S02 Rpr Set Back Wiring", { labor: 0.5 })]
    );
    expect(pairs).toEqual(["21-61"]);
  });

  it("a one-word line still pairs on its word under the same operation", () => {
    expect(pairsOf([engineRow(45, "* Rpr Battery", { labor: 0.3, laborClass: "E" })], [engineRow(62, "# S02 Rpr D&R battery/Reset Electronics", { labor: 0.5 })])).toEqual(["45-62"]);
  });

  it("'Four wheel suspension alignment' is the carrier's 'Four Wheel Alignment', and interior protection pairs", () => {
    const pairs = pairsOf(
      [engineRow(54, "# Subl Four wheel suspension alignment", { price: 268 }), engineRow(80, "# Interior Protection kit", { price: 3.22, labor: 0.1 })],
      [engineRow(47, "# S02 Subl Four Wheel Alignment", { price: 98 }), engineRow(64, "# S02 Cover Car for Interior", { price: 5 })]
    );
    expect(pairs.sort()).toEqual(["54-47", "80-64"]);
  });
});

const deltaRow = (line: number, description: string, labor: number | null, laborType: string | null = null, price: number | null = null): EstimateDeltaRow => ({
  lineNumber: line,
  opCode: "Rpr",
  description,
  descriptionTokens: description.toLowerCase().split(/\W+/).filter(Boolean),
  partNumber: null,
  section: "VEHICLE DIAGNOSTICS",
  qty: null,
  price,
  labor,
  laborIncluded: false,
  paint: null,
  paintIncluded: false,
  laborType,
  rawText: `${line} Rpr ${description}`,
});
const missing = (row: EstimateDeltaRow): EstimateLineItemDelta => ({
  kind: "missing_operation",
  lowerRow: null,
  higherRow: row,
  matchBasis: "none",
  laborDelta: row.labor,
  paintDelta: null,
  priceDelta: row.price,
  summary: `Higher estimate documents "${row.description}"; this operation is not present on the lower estimate.`,
  annotate: true,
});
const carrierText = (note: string) =>
  [
    "Workfile ID: a1b2c3d4",
    "Line Oper Description",
    // Row numbers climb from the top of the sheet, as CCC prints them.
    "10 FRONT BUMPER & GRILLE",
    "30 HOOD",
    "50 FRONT SUSPENSION",
    "56 VEHICLE DIAGNOSTICS",
    "57*S03  Rpr  Other diagnostic services-TESLA",
    "TOOLBOX",
    "00.00m1.0M0.0",
    `NOTE: ${note}`,
    "58#S02  Rpr  Road Test For Safety00.000.50.0",
    "SUBTOTALS",
  ].join("\n");

describe("a carrier line whose own note names the work it includes", () => {
  const ours = () => [
    deltaRow(66, "Pre-repair scan", 1.0, "3"),
    deltaRow(67, "Research DTC's", 0.5, "3"),
    deltaRow(68, 'Place vehicle in "Service Mode"', 0.1, "3"),
    deltaRow(71, "Set up & initiate camera", 1.0, "3"),
    deltaRow(72, "Capture image & adjust cameras", 0.6, "3"),
    deltaRow(74, "Drive time for camera calibration procedure", 1.0, "3"),
    deltaRow(75, "Post-repair scan", 1.0, "3"),
    deltaRow(77, 'Remove vehicle from "Service Mode"', 0.1, "3"),
  ];
  const theirs = () => deltaRow(57, "S03 Rpr Other diagnostic services-TESLA", 1.0, "M");

  it("is compared once with the lines of ours that do that work; neither side is 'missing'", () => {
    const lower = theirs();
    const result = applyComparisonInclusionNotes({
      deltas: ours().map(missing),
      lowerOnlyRows: [lower],
      comparisonText: carrierText("(includes pre and post and 1 Calibration and Service Mode)"),
      comparisonName: "SOR.pdf",
    });
    expect(result.lowerOnlyRows).toEqual([]);
    // Research DTC's is not work the note names: it stays a missing line.
    expect(result.deltas.filter((d) => d.kind === "missing_operation").map((d) => d.higherRow.lineNumber)).toEqual([67]);
    const covered = result.deltas.find((d) => d.kind === "reduced_labor");
    expect(covered).toMatchObject({ lowerRow: lower, laborDelta: 3.8, coveredHigherLines: [66, 68, 71, 72, 74, 75, 77] });
    expect(covered?.summary).toContain("states it includes pre and post and 1 Calibration and Service Mode");
    expect(covered?.summary).toContain("4.8 hr in total");
    // The dispute layer sees one pair, flagged as covered by the carrier's note.
    // Drive time (L74) and taking the vehicle out of service mode (L77) are not
    // named by the note's words; they are carried as counted by inference.
    expect(pairsFromDeltas(result.deltas)).toContainEqual({
      kind: "reduced",
      shopLines: [66, 68, 71, 72, 74, 75, 77],
      carrierLine: 57,
      coveredByCarrierNote: true,
      inferredShopLines: [74, 77],
    });
  });

  it("a note that EXCLUDES the work changes nothing", () => {
    const deltas = ours().map(missing);
    const lower = theirs();
    const result = applyComparisonInclusionNotes({
      deltas,
      lowerOnlyRows: [lower],
      comparisonText: carrierText("(does not include calibration or pre and post scans)"),
      comparisonName: "SOR.pdf",
    });
    expect(result.deltas).toEqual(deltas);
    expect(result.lowerOnlyRows).toEqual([lower]);
  });

  it("the dispute report argues their line, quoting the note, and never argues an equal-value pair", () => {
    const shop = estimate("shop", [
      { line: 66, oper: "Rpr", desc: "Pre-repair scan", hours: 1.0, laborCat: "other", laborLabel: "Calibration/Reset" },
      { line: 75, oper: "Rpr", desc: "Post-repair scan", hours: 1.0, laborCat: "other", laborLabel: "Calibration/Reset" },
      { line: 55, oper: "", desc: "Transport vehicle to & from sublet", hours: 1.0, laborCat: "body" },
    ]);
    shop.totals.labor.push({ cat: "other", label: "Calibration/Reset", hours: 7.6, rate: 175, cost: 1330 });
    const carrier = estimate("carrier", [
      { line: 57, oper: "Rpr", desc: "Other diagnostic services-TESLA", hours: 1.0, laborCat: "mechanical", note: "(includes pre and post and 1 Calibration and Service Mode)" },
      { line: 48, oper: "Rpr", desc: "Transport To & From Alignment", hours: 1.0, laborCat: "body" },
    ]);
    const items = argueItems({
      shop,
      carrier,
      groups: [],
      usedShop: new Set(),
      flags: [],
      pairs: [
        { kind: "reduced", shopLines: [66, 75], carrierLine: 57, coveredByCarrierNote: true },
        { kind: "matched", shopLines: [55], carrierLine: 48 },
      ],
    });
    // The title is read on its own, so it states only the comparison; the
    // detail says which of our lines the note's words name.
    expect(items.map((item) => item.title)).toEqual(["Other diagnostic services-TESLA and the lines compared with it"]);
    // The note is quoted, and what it does not establish is said: it never
    // divides its hour among our steps or states that each one is paid.
    expect(items[0].detail).toBe(
      'Ours 2.0 hr (L66, L75), theirs 1.0 hr (L57), whose note reads "includes pre and post and 1 Calibration and Service Mode". ' +
        "The note's words name the work on our L66, L75. The note does not say how its 1.0 hr divides among these steps or that each step is paid."
    );
  });
});

describe("a side group merged into one delta keeps each side's own counterpart", () => {
  it("(both sides, L41/L42) returns L41-L32 and L42-L37, and equal pairs come back as matched", () => {
    const merged: EstimateLineItemDelta = {
      ...missing(deltaRow(41, "Wheel opng mldg (both sides, L41/L42)", 0.5, null, 135)),
      kind: "part_or_price_difference",
      lowerRow: deltaRow(32, "A/M RT Wheel opng mldg", 0.5, null, 73.88),
      mergedMembers: [
        { higherLine: 41, lowerLine: 32 },
        { higherLine: 42, lowerLine: 37 },
      ],
    };
    expect(pairsFromDeltas([merged], [{ higherLine: 55, lowerLine: 48 }])).toEqual([
      { kind: "reduced", shopLines: [41], carrierLine: 32 },
      { kind: "reduced", shopLines: [42], carrierLine: 37 },
      { kind: "matched", shopLines: [55], carrierLine: 48 },
    ]);
  });
});

describe("finishing written as one paint line on ours and two body lines on theirs is one group", () => {
  it("their denib + color sand and buff pays more than our finish sand & polish", () => {
    const shop = estimate("shop", [{ line: 82, oper: "", desc: "Finish sand & polish", paintHours: 1.0 }]);
    shop.totals.labor.push({ cat: "paint", label: "Paint Labor", hours: 6.7, rate: 90, cost: 603 });
    const carrier = estimate("carrier", [
      { line: 66, oper: "Rpr", desc: "Denib and Polish", hours: 0.5, laborCat: "body" },
      { line: 67, oper: "Repl", desc: "Color Sand and Buff", hours: 1.0, laborCat: "body", price: 12 },
    ]);
    const { groups } = groupEquivalents(shop, carrier);
    expect(groups).toEqual([
      expect.objectContaining({ key: "finish", shopLines: [82], carrierLines: [66, 67], shopHours: 1.0, carrierHours: 1.5, shopValue: 90, carrierValue: 147 }),
    ]);
  });
});

// ---------------------------------------------------------------------------
// Labor categories: a shop-defined digit is its printed category, never body.
// ---------------------------------------------------------------------------

describe("a CCC user-defined labor digit names the printed category with those hours", () => {
  const aluminum = { cat: "aluminum" as const, label: "Aluminum Or Steel Repair", hours: 1.0, rate: 135, cost: 135 };
  const calibration = { cat: "other" as const, label: "Calibration/Reset", hours: 7.6, rate: 175, cost: 1330 };

  it("digits 1 and 3 with category 2 unused: 3 is Calibration/Reset, the SECOND printed", () => {
    const byDigit = userCategoriesByDigit(new Map([["1", 1.0], ["3", 7.6]]), [aluminum, calibration]);
    expect(byDigit.get("1")?.label).toBe("Aluminum Or Steel Repair");
    expect(byDigit.get("3")?.label).toBe("Calibration/Reset");
  });

  it("hours that do not decide fall back to numeric order against print order", () => {
    const byDigit = userCategoriesByDigit(new Map([["3", 2.0], ["1", 2.0]]), [{ ...aluminum, hours: 2.0 }, { ...calibration, hours: 2.0 }]);
    expect(byDigit.get("1")?.label).toBe("Aluminum Or Steel Repair");
    expect(byDigit.get("3")?.label).toBe("Calibration/Reset");
  });

  it("a line in that category is valued at its own category's rate, not its family's", () => {
    const shop = estimate("shop", []);
    shop.totals.labor.push({ cat: "other", label: "Electrical Labor", hours: 0.3, rate: 125, cost: 37.5 }, calibration);
    expect(shopLineRate(shop, { laborCat: "other", laborLabel: "Calibration/Reset" })).toBe(175);
    expect(shopLineRate(shop, { laborCat: "other", laborLabel: "Electrical Labor" })).toBe(125);
  });

  it("the Citation Density stamps tag an Electrical or Calibration/Reset line by its category, never 'Body'", () => {
    expect(catTag({ laborCat: "other", laborLabel: "Electrical Labor" })).toBe(" E");
    expect(catTag({ laborCat: "other", laborLabel: "Calibration/Reset" })).toBe(" Calib.");
    expect(catTag({ laborCat: "other" })).toBe("");
    expect(catTag({ laborCat: "mechanical" })).toBe(" M");
  });

  it("findings name the category, never 'body labor'", () => {
    expect(laborTypeNoun("3", "Calibration/Reset")).toBe("Calibration/Reset labor");
    expect(laborTypeNoun("3")).toBe("user-defined category 3 labor");
    expect(laborTypeNoun("")).toBe("body labor");
  });
});

describe("absence claims against the category gaps", () => {
  const totals = (categories: Array<[string, number]>) => ({
    categories: categories.map(([category, hours]) => ({ category, hours, rate: 90, cost: hours * 90 })),
    subtotal: null,
    salesTax: null,
    grandTotal: null,
    taxLanes: [],
  });

  it("a priced line with a 0.0 labor cell and a shop-defined-category line are not body-labor claims", () => {
    const deltas = [missing(deltaRow(46, "Wiring to ped spkr", 0, null, 649.9)), missing(deltaRow(70, "In-Proc repair scan", 1.0, "3"))];
    const result = reconcileMissingClaimsAgainstTotals({ deltas, higher: totals([["Body Labor", 12.2]]), lower: totals([["Body Labor", 13.2]]) });
    expect(result.flagged).toBe(0);
    expect(deltas.some((delta) => delta.exceedsCategoryGap)).toBe(false);
  });

  it("when their body labor is HIGHER than ours, the claims are bounded by the total hours gap instead", () => {
    const deltas = [missing(deltaRow(79, "Pre wash vehicle", 0.5)), missing(deltaRow(83, "Clean vehicle for delivery", 0.5)), missing(deltaRow(84, "Maintain HV battery state of charge", 0.5))];
    const result = reconcileMissingClaimsAgainstTotals({
      deltas,
      higher: totals([["Body Labor", 12.2], ["Paint Labor", 6.7], ["Calibration/Reset", 7.6]]),
      lower: totals([["Body Labor", 13.2], ["Paint Labor", 5.7]]),
    });
    expect(result.flagged).toBe(0);
    expect(result.notes[0]).toMatch(/total hours gap of 7\.6 h/);
    // Claims the total gap cannot hold are still verify items.
    const many = Array.from({ length: 9 }, (_, i) => missing(deltaRow(100 + i, `Operation ${i}`, 1.0)));
    const strict = reconcileMissingClaimsAgainstTotals({
      deltas: many,
      higher: totals([["Body Labor", 12.2], ["Paint Labor", 6.7], ["Calibration/Reset", 7.6]]),
      lower: totals([["Body Labor", 13.2], ["Paint Labor", 5.7]]),
    });
    expect(strict.flagged).toBe(9);
  });
});
