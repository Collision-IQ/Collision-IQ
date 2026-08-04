/**
 * A SUBTOTALS rule closes the ESTIMATE BODY. What follows it on a supplement
 * is the SUPPLEMENT SUMMARY — a changelog of Deleted and Added items, history
 * rather than inventory — and its deleted lines carry NEGATIVE hours.
 *
 * RO 22116 shipped a delta report with ZERO findings because of this. The
 * SOR-2 prints 44.7 labor hours; its body rows sum to exactly 44.7; its
 * changelog pages contribute -2.7. Summing every parsed row against a subtotal
 * that never included the changelog produced a phantom 2.7-hour shortfall, the
 * column-identity guard concluded the extract had lost column identity, and
 * all 91 matched pairs and 61 findings were discarded. The extraction was
 * perfect. The reconciliation was asking the wrong question.
 *
 * Production returned HTTP 200 with an empty report and no warning, which
 * reads to a user as "no differences found" — the failure mode this guards.
 */
import { describe, it, expect } from "vitest";

/** The reconciliation rule under test, in the shape the builder applies it. */
function reconciles(
  rows: Array<{ page: number; labor: number | null; paint: number | null }>,
  printed: { page: number; labor: number | null; paint: number | null }
): boolean {
  const body = printed.page ? rows.filter((row) => row.page <= printed.page) : rows;
  const laborSum = body.reduce((total, row) => total + (row.labor ?? 0), 0);
  const paintSum = body.reduce((total, row) => total + (row.paint ?? 0), 0);
  const laborOk = printed.labor === null || Math.abs(laborSum - printed.labor) <= 0.21;
  const paintOk = printed.paint === null || Math.abs(paintSum - printed.paint) <= 0.21;
  return laborOk && paintOk;
}

/** RO 22116 SOR-2, at the measured per-page labor totals. */
const SOR_22116 = [
  { page: 3, labor: 12.1, paint: 0 },
  { page: 4, labor: 17.6, paint: 0 },
  { page: 5, labor: 4.4, paint: 0 },
  { page: 6, labor: 10.6, paint: 0 },
  // SUPPLEMENT SUMMARY — Deleted Items, negative by construction.
  { page: 8, labor: -0.5, paint: 0 },
  { page: 9, labor: -2.2, paint: 0 },
];
const PRINTED_22116 = { page: 6, labor: 44.7, paint: null };

describe("reconciliation stops at the SUBTOTALS rule", () => {
  it("the body rows sum to the printed figure exactly", () => {
    const body = SOR_22116.filter((row) => row.page <= PRINTED_22116.page);
    expect(body.reduce((total, row) => total + row.labor, 0)).toBeCloseTo(44.7, 2);
  });

  it("RO 22116 reconciles, so its 61 findings are not discarded", () => {
    expect(reconciles(SOR_22116, PRINTED_22116)).toBe(true);
  });

  it("summing the changelog too is what invented the shortfall", () => {
    const everyRow = SOR_22116.reduce((total, row) => total + row.labor, 0);
    expect(everyRow).toBeCloseTo(42.0, 2);
    expect(Math.abs(everyRow - 44.7)).toBeCloseTo(2.7, 2);
  });

  it("a genuine column-identity failure inside the body still fails", () => {
    // The guard must keep working: mistyped cells in the body are the real
    // condition it exists to catch.
    const broken = [
      { page: 3, labor: 12.1, paint: 0 },
      { page: 4, labor: 3.2, paint: 0 }, // a paint column read as labor
      { page: 5, labor: 4.4, paint: 0 },
      { page: 6, labor: 10.6, paint: 0 },
    ];
    expect(reconciles(broken, PRINTED_22116)).toBe(false);
  });

  it("a document with no supplement summary is unaffected", () => {
    const simple = [
      { page: 1, labor: 20.0, paint: 0 },
      { page: 2, labor: 34.7, paint: 0 },
    ];
    expect(reconciles(simple, { page: 2, labor: 54.7, paint: null })).toBe(true);
  });
});
