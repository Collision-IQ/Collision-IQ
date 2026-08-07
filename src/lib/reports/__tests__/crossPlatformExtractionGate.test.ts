/**
 * Test 97 regression — the cross-platform, image-only failure class.
 *
 * The pair that produced it: a 250-operation CCC estimate against a Mitchell
 * supplement supplied as an image-only PDF. Glyph repair recovered no line
 * items, the matcher compared 250 subject lines against an empty pool, and
 * roughly 230 of them shipped as "not written on the comparison estimate" —
 * at least 18 against operations the carrier had funded, four to the cent.
 *
 * Every assertion here is paired with a same-platform control, because the
 * same-platform path was accurate before these changes and must stay that way.
 * A gate that fires on a healthy run is a worse defect than the one it fixes.
 */
import { describe, expect, it } from "vitest";
import { assessComparisonExtraction } from "../estimateDeltaMatcher";
import { isPlausibleTotalsCategory } from "../deltaEngine/rowCluster";
import { compareTotals } from "../deltaEngine/deltaPair";
import { runDeltaReleaseGate, mayRelease } from "../deltaReleaseGate";
import { canonTotalsCategory } from "../deltaEngine/estimateNormalize";

const rows = (count: number, start = 1) =>
  Array.from({ length: count }, (_, index) => ({ lineNumber: start + index }));

describe("extraction coverage gate (F1)", () => {
  it("gates a substantive comparison that yielded almost no rows", () => {
    // What the Mitchell S2 actually produced: a handful of stray fragments.
    const assessment = assessComparisonExtraction(rows(3), { subjectRowCount: 250 });
    expect(assessment.gate).toBe(true);
    expect(assessment.gateReason).toBe("source_not_read");
  });

  it("does not gate on a large comparison total alone", () => {
    // "Big total, few parsed lines" is not evidence of a read failure — a
    // supplement can carry most of its money on a handful of lines. Keying the
    // limb on the total suppressed three correct rate findings on a healthy
    // same-platform pair (one comparison line item, $27,232 printed total).
    const assessment = assessComparisonExtraction(rows(1), { subjectRowCount: 1 });
    expect(assessment.gate).toBe(false);
  });

  it("would not have fired before the fix — the regression is real", () => {
    // The original gate required parsedRows >= 15, so total failure could not
    // reach it. Asserting the old predicate directly keeps that documented.
    const assessment = assessComparisonExtraction(rows(3), { subjectRowCount: 250 });
    const oldGate = assessment.parsedRows >= 15 && assessment.impliedRows >= 40 && assessment.coverage < 0.5;
    expect(oldGate).toBe(false);
    expect(assessment.gate).toBe(true);
  });

  // --- same-platform controls -------------------------------------------------

  it("leaves a healthy same-platform pair alone", () => {
    const assessment = assessComparisonExtraction(rows(180), { subjectRowCount: 210 });
    expect(assessment.gate).toBe(false);
    expect(assessment.gateReason).toBeNull();
  });

  it("does not mistake genuinely narrow carrier scope for a read failure", () => {
    // RO 22182: a 33-line carrier Estimate of Record against a 179-line shop
    // estimate. That is the carrier's real scope and it is the finding.
    const assessment = assessComparisonExtraction(rows(33), { subjectRowCount: 179 });
    expect(assessment.gate).toBe(false);
  });

  it("still catches the partial-read case it was built for", () => {
    const sparse = [1, 9, 20, 33, 41, 55, 62, 70, 78, 84, 96, 108, 119, 131, 140, 152, 161, 175].map(
      (lineNumber) => ({ lineNumber })
    );
    const assessment = assessComparisonExtraction(sparse, { subjectRowCount: 200 });
    expect(assessment.gate).toBe(true);
    expect(assessment.gateReason).toBe("partial_line_coverage");
  });

  it("does not gate a small pair where neither side is substantive", () => {
    const assessment = assessComparisonExtraction(rows(4), { subjectRowCount: 6 });
    expect(assessment.gate).toBe(false);
  });
});

describe("totals vocabulary (F3)", () => {
  it("rejects the publisher boilerplate that shipped as spending categories", () => {
    expect(isPlausibleTotalsCategory("All Rights Reserved", 18, null)).toBe(false);
    expect(
      isPlausibleTotalsCategory("Mitchell Estimating Copyright Mitchell International, Inc.", 26.2, 0)
    ).toBe(false);
    expect(isPlausibleTotalsCategory("PA MALV ALL PART TYPES", null, null)).toBe(false);
  });

  it("rejects numbers that cannot be a labour basis", () => {
    expect(isPlausibleTotalsCategory("Body Labor", 9000, 61)).toBe(false);
    expect(isPlausibleTotalsCategory("Body Labor", 78.9, 100000)).toBe(false);
  });

  it("accepts every real category on both platforms", () => {
    for (const category of [
      "Parts",
      "Body Labor",
      "Paint Labor",
      "Refinish Labor",
      "Structural Labor",
      "Frame Labor",
      "Mechanical Labor",
      "Diagnostic Labor",
      "Glass Labor",
      "Paint Supplies",
      "Paint Materials",
      "Sublet Labor Credit",
      "Miscellaneous",
      "Sales Tax",
    ]) {
      expect(isPlausibleTotalsCategory(category, 12.5, 61), category).toBe(true);
    }
  });
});

describe("null is not zero in classification (F3)", () => {
  const row = (category: string, hours: number | null, rate: number | null, amount: number) => ({
    category,
    hours,
    rate,
    amount,
  });

  it("asserts no rate difference when the comparison rate could not be read", () => {
    const deltas = compareTotals(
      [row("Body Labor", 78.9, 61, 4812.9)],
      [row("Body Labor", null, null, 3152.6)],
      canonTotalsCategory
    );
    expect(deltas.some((delta) => delta.field === "rate")).toBe(false);
    expect(deltas.some((delta) => delta.field === "hours")).toBe(false);
    // The amount difference is real and still reported.
    expect(deltas.find((delta) => delta.field === "amount")?.competing).toBe(3152.6);
  });

  it("still reports a genuine rate difference", () => {
    const deltas = compareTotals(
      [row("Body Labor", 78.9, 61, 4812.9)],
      [row("Body Labor", 50.6, 55, 2783)],
      canonTotalsCategory
    );
    expect(deltas.find((delta) => delta.field === "rate")?.competing).toBe(55);
    expect(deltas.find((delta) => delta.field === "hours")?.competing).toBe(50.6);
  });

  it("reports no rate dispute when the rates agree — the sentence that was lost", () => {
    const deltas = compareTotals(
      [row("Body Labor", 78.9, 61, 4812.9)],
      [row("Body Labor", 50.6, 61, 3086.6)],
      canonTotalsCategory
    );
    expect(deltas.some((delta) => delta.field === "rate")).toBe(false);
    expect(deltas.find((delta) => delta.field === "hours")?.competing).toBe(50.6);
  });
});

describe("release gate R19/R22", () => {
  it("R19 fails a bundle that calls operations absent from an unread document", () => {
    const violations = runDeltaReleaseGate({
      source: { file: "S2.pdf", extraction: { parsed_rows: 3, gate_reason: "source_not_read" } },
      findings: Array.from({ length: 230 }, (_, index) => ({
        id: `f${index}`,
        type: "missing_operation",
        anchors: [`r${index}`],
      })),
    });
    const r19 = violations.filter((violation) => violation.rule === "R19");
    expect(r19.length).toBeGreaterThan(0);
    expect(mayRelease(violations)).toBe(false);
  });

  it("R19 passes when the same bundle carries no line verdicts", () => {
    const violations = runDeltaReleaseGate({
      source: { file: "S2.pdf", extraction: { parsed_rows: 3, gate_reason: "source_not_read" } },
      findings: [{ id: "intake", type: "total_gap" }],
    });
    expect(violations.filter((violation) => violation.rule === "R19")).toEqual([]);
  });

  it("R19 leaves a healthy same-platform bundle alone", () => {
    const violations = runDeltaReleaseGate({
      source: { file: "Shop B.pdf", extraction: { parsed_rows: 180, gate_reason: null } },
      findings: [{ id: "f1", type: "missing_operation", anchors: ["r1"] }],
    });
    expect(violations.filter((violation) => violation.rule === "R19")).toEqual([]);
  });

  it("R22 fails boilerplate parsed as a spending category", () => {
    const violations = runDeltaReleaseGate({
      totals_categories: [
        { category: "Body Labor", hours: 50.6, rate: 61 },
        { category: "All Rights Reserved", hours: 18, rate: 0 },
      ],
    });
    const r22 = violations.filter((violation) => violation.rule === "R22");
    expect(r22.length).toBeGreaterThan(0);
    expect(mayRelease(violations)).toBe(false);
  });

  it("R22 passes a real totals table", () => {
    const violations = runDeltaReleaseGate({
      totals_categories: [
        { category: "Parts", hours: null, rate: null },
        { category: "Body Labor", hours: 50.6, rate: 61 },
        { category: "Paint Materials", hours: 17.8, rate: 42 },
      ],
    });
    expect(violations.filter((violation) => violation.rule === "R22")).toEqual([]);
  });
});
