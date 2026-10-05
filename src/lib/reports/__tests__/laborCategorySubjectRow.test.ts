/**
 * RO 22120 review, "Labor category": the shop's printed category controls
 * its hours. A reduced-labor delta named its labor category from the
 * COMPARISON line whenever our line's labor field carried no letter, so an
 * unmarked shop line (body labor, as CCC prints it) read as "mechanical
 * labor" because the carrier's line was marked M. The category is the
 * subject line's own; the opposing line's letter never stands in for it.
 *
 * A delta that compares several of our lines together (a comparison line's
 * inclusion note) carries no letter when those lines' categories differ, so
 * it names plain "labor" rather than any one category.
 *
 * Inputs are de-identified: line text in the shape the prints carry.
 */
import { describe, expect, it } from "vitest";
import { describeLineItemDelta } from "../annotatedCitationDensityEstimate";
import { applyComparisonInclusionNotes } from "../comparisonInclusionNotes";
import {
  matchEstimateLineItems,
  parseCccEstimateRows,
  type EstimateDeltaRow,
  type EstimateLineItemDelta,
} from "../estimateDeltaMatcher";

const reducedFor = (ours: string, theirs: string): EstimateLineItemDelta => {
  const match = matchEstimateLineItems({
    higherRows: parseCccEstimateRows(["BRAKES", ours].join("\n")),
    lowerRows: parseCccEstimateRows(["BRAKES", theirs].join("\n")),
  });
  const delta = match.deltas.find((d) => d.kind === "reduced_labor");
  expect(delta, "the two lines pair as a reduced-labor delta").toBeDefined();
  return delta!;
};

describe("a reduced-labor delta names OUR line's own labor category", () => {
  it("an unmarked shop line paired with a carrier M line is body labor, not mechanical", () => {
    const delta = reducedFor(
      "44 Repl Bleed brake system 1 0.00 m 1.5 0.0",
      "31 Repl Bleed brake system 1 0.00 m 0.3 M 0.0"
    );
    expect(delta.higherRow.laborType ?? null).toBeNull();
    expect(delta.lowerRow?.laborType).toBe("M");
    // Matcher summary (forensic / citation wording).
    expect(delta.summary).not.toMatch(/mechanical/i);
    expect(delta.summary).toContain("1.5 body labor hr");
    // Finding title, proof and next action.
    const meta = describeLineItemDelta(delta);
    for (const text of [meta.title, meta.missingProof, meta.nextAction]) {
      expect(text).not.toMatch(/mechanical/i);
      expect(text).toMatch(/body labor/);
    }
  });

  it("a shop line marked M stays mechanical labor, whatever the carrier line prints", () => {
    const delta = reducedFor(
      "44 Repl Bleed brake system 1 0.00 m 1.5 M 0.0",
      "31 Repl Bleed brake system 1 0.00 m 0.3 0.0"
    );
    expect(delta.higherRow.laborType).toBe("M");
    expect(delta.summary).toContain("1.5 mechanical labor hr");
    const meta = describeLineItemDelta(delta);
    expect(meta.title).toMatch(/allows less mechanical labor/);
    expect(meta.missingProof).toMatch(/mechanical labor/);
  });
});

describe("a delta covering several of our lines names a category only when they share one", () => {
  const row = (lineNumber: number, description: string, labor: number, laborType: string | null): EstimateDeltaRow =>
    ({
      lineNumber,
      section: "VEHICLE DIAGNOSTICS",
      opCode: "Rpr",
      description,
      partNumber: null,
      qty: 1,
      price: 0,
      labor,
      paint: null,
      laborType,
      rawText: `${lineNumber} Rpr ${description}`,
      anchorId: null,
    }) as unknown as EstimateDeltaRow;
  const missing = (higherRow: EstimateDeltaRow): EstimateLineItemDelta =>
    ({
      kind: "missing_operation",
      higherRow,
      lowerRow: null,
      matchBasis: "none",
      laborDelta: higherRow.labor,
      paintDelta: null,
      priceDelta: null,
      summary: "",
    }) as unknown as EstimateLineItemDelta;
  const bundle = row(57, "S03 Rpr Other diagnostic services-DEALER", 1.0, "M");
  const covered = (ours: EstimateDeltaRow[]) =>
    applyComparisonInclusionNotes({
      deltas: ours.map(missing),
      lowerOnlyRows: [bundle],
      comparisonText: [
        "Workfile ID: a1b2c3d4",
        "Line Oper Description",
        "10 FRONT BUMPER & GRILLE",
        "30 HOOD",
        "50 FRONT SUSPENSION",
        "56 VEHICLE DIAGNOSTICS",
        "57*S03  Rpr  Other diagnostic services-DEALER",
        "TOOLBOX",
        "00.00m1.0M0.0",
        "NOTE: (includes pre and post and 1 Calibration and Service Mode)",
        "58#S02  Rpr  Road Test For Safety00.000.50.0",
        "SUBTOTALS",
      ].join("\n"),
      comparisonName: "Comparison.pdf",
    }).deltas.find((d) => d.coveredHigherLines?.length);

  it("mixed categories (M and unmarked) read as plain labor, never the carrier's or body", () => {
    const delta = covered([row(68, "Pre-repair scan", 1.0, "M"), row(74, "Initiate camera calibration", 0.5, null)]);
    expect(delta).toBeDefined();
    expect(delta!.higherRow.laborType ?? null).toBeNull();
    const meta = describeLineItemDelta(delta!);
    expect(meta.title).toMatch(/^Comparison estimate allows less labor: /);
    for (const text of [meta.title, meta.missingProof, meta.nextAction]) {
      expect(text).not.toMatch(/mechanical|body labor/i);
    }
  });

  it("covered lines that all share M stay mechanical labor", () => {
    const delta = covered([row(68, "Pre-repair scan", 1.0, "M"), row(77, "Post-repair scan", 1.0, "M")]);
    expect(describeLineItemDelta(delta!).title).toMatch(/allows less mechanical labor/);
  });
});
