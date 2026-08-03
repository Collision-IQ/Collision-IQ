/**
 * test-93 — RO 22185 · 2022 BMW X7 · Erie claim A00007793947-1
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PROVENANCE, STATED PLAINLY: the RO 22185 PDFs were NOT supplied with the
 * review. This fixture is reconstructed from the values the review states as
 * verified — totals, rate deltas, the two tail-lamp prices, the clear-coat
 * aggregate, the carrier-only bracket, and the four contradicted operations.
 * It therefore guards the INVARIANTS the review demanded; it is not a
 * regression test against the real documents, and it cannot become one until
 * `Shop 22185.pdf` and `EOR 22185.pdf` are in tests/fixtures/22185/.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect } from "vitest";
import {
  findBucketContradictions,
  isDeductionRow,
  matchEstimateLineItems,
  parseCccEstimateRows,
  compareEstimateTotals,
  parseCccEstimateTotals,
} from "../estimateDeltaMatcher";
import { canonicalOperationKey } from "../operationAliases";
import { findFabricatedCurrency } from "../../ai/numericIntegrity";
import { scoreEstimateRoleSignals, resolveTriageRoles } from "../estimateTriageClassifier";

/** Shop line items, in the shop's own wording, at the review's stated values. */
const SHOP_LINES = [
  "REAR BUMPER",
  "60 Repl Bumper cover 51127420665 1 900.00 2.5 1.8",
  "61 Repl LT Tail lamp assy 63217420123 1 686.05",
  "65 Repl LT Tail lamp 63217420456 1 480.22",
  "76 Overlap Major Non-Adj. Panel -0.2",
  "79 Overlap Major Non-Adj. Panel -0.2",
  "VEHICLE DIAGNOSTICS",
  "30 Rpr Pre-repair scan 1 0.00 m 1.5",
  "31 Rpr Post-repair scan 1 0.00 m 1.0",
  "MISCELLANEOUS OPERATIONS",
  "40 # Flex additive 1 12.00",
  "41 # Clean vehicle for delivery 1 5.00",
].join("\n");

/** Erie's Estimate of Record, in Erie's wording. */
const ERIE_LINES = [
  "REAR BUMPER",
  "10 Repl Bumper cover 51127420665 1 900.00 2.5 1.8",
  "11 Repl LT Tail lamp assy 63217420123 1 619.71",
  "12 Repl LT Tail lamp 63217420456 1 433.81",
  "13 Repl LT Inner bracket 51127420665A 1 80.56",
  "VEHICLE DIAGNOSTICS",
  "19 Rpr Pre-Diagnostic Scan Charge 1 0.00 m 1.0",
  "20 Rpr Post-Diagnostic Scan Charge 1 0.00 m 0.5",
  "MISCELLANEOUS OPERATIONS",
  "21 # Flex Agent 1 5.00",
  "22 # Clean & Detail for Delivery 1 5.00",
].join("\n");

const SHOP_TOTALS = [
  "ESTIMATE TOTALS",
  "Body Labor 30.0 hrs @ $ 75.00 /hr 2,250.00",
  "Paint Supplies 10.0 hrs @ $ 60.00 /hr 600.00",
  "Parts 2,835.94",
  "Grand Total 8,745.29",
].join("\n");

const ERIE_TOTALS = [
  "ESTIMATE TOTALS",
  "Body Labor 4.6 hrs @ $ 62.00 /hr 285.20",
  "Paint Supplies 5.0 hrs @ $ 41.00 /hr 205.00",
  "Parts 2,518.23",
  "Grand Total 3,642.51",
].join("\n");

const shopRows = parseCccEstimateRows(SHOP_LINES);
const erieRows = parseCccEstimateRows(ERIE_LINES);
const match = matchEstimateLineItems({ lowerRows: erieRows, higherRows: shopRows });

describe("roles resolve from what the documents say about themselves", () => {
  it("the Estimate of Record is the carrier document, whatever it costs", () => {
    const estimates = [
      {
        filename: "EOR 22185.pdf",
        scores: scoreEstimateRoleSignals(
          "EOR 22185.pdf",
          "Erie Insurance Group\nEstimate of Record\nAdjuster License Number 0527619\nGrand Total 3,642.51"
        ),
      },
      {
        filename: "Shop 22185.pdf",
        scores: scoreEstimateRoleSignals(
          "Shop 22185.pdf",
          "Preliminary Estimate\nCollision Center\nRO Number: 22185\nGrand Total 8,745.29"
        ),
      },
    ];
    const resolved = resolveTriageRoles(estimates);
    expect(resolved.carrier?.filename).toBe("EOR 22185.pdf");
    expect(resolved.shop?.filename).toBe("Shop 22185.pdf");
    expect(resolved.basis).toBe("document_markers");
  });
});

describe("the four contradicted operations", () => {
  const CANONICAL_PAIRS: Array<[string, string]> = [
    ["Pre-repair scan", "Pre-Diagnostic Scan Charge"],
    ["Post-repair scan", "Post-Diagnostic Scan Charge"],
    ["Flex additive", "Flex Agent"],
    ["Clean vehicle for delivery", "Clean & Detail for Delivery"],
  ];

  it("each pair shares a canonical operation key", () => {
    for (const [shopWording, carrierWording] of CANONICAL_PAIRS) {
      const key = canonicalOperationKey(shopWording);
      expect(key).toBeTruthy();
      expect(canonicalOperationKey(carrierWording)).toBe(key);
    }
  });

  it("none of them is reported as missing from the carrier", () => {
    const missing = match.deltas
      .filter((delta) => delta.kind === "missing_operation")
      .map((delta) => canonicalOperationKey(delta.higherRow.description));
    for (const [shopWording] of CANONICAL_PAIRS) {
      expect(missing).not.toContain(canonicalOperationKey(shopWording));
    }
  });

  it("none of them is reported as carrier-only either", () => {
    const carrierOnly = match.lowerOnlyRows.map((row) => canonicalOperationKey(row.description));
    for (const [, carrierWording] of CANONICAL_PAIRS) {
      expect(carrierOnly).not.toContain(canonicalOperationKey(carrierWording));
    }
  });

  it("no operation is claimed by both buckets at once", () => {
    expect(findBucketContradictions(match.deltas, match.lowerOnlyRows)).toEqual([]);
    expect(match.contradictions).toEqual([]);
  });

  it("the disagreements survive as value deltas — the stronger argument", () => {
    const flex = match.deltas.find((delta) => /flex/i.test(delta.summary));
    expect(flex?.kind).not.toBe("missing_operation");
    expect(flex?.priceDelta).toBeCloseTo(7, 2);
    const preScan = match.deltas.find((delta) => /pre-repair scan/i.test(delta.summary));
    expect(preScan?.kind).toBe("reduced_labor");
    expect(preScan?.laborDelta).toBeCloseTo(0.5, 2);
  });
});

describe("value and quantity deltas the review verified", () => {
  it("both tail lamp price differences surface", () => {
    const first = match.deltas.find((delta) => delta.higherRow.lineNumber === 61);
    expect(first?.priceDelta).toBeCloseTo(66.34, 2);
    const second = match.deltas.find((delta) => delta.higherRow.lineNumber === 65);
    expect(second?.priceDelta).toBeCloseTo(46.41, 2);
  });

  it("the carrier-only inner bracket is $80.56 — not $180.56", () => {
    const bracket = match.lowerOnlyRows.find((row) => /inner bracket/i.test(row.description));
    expect(bracket?.price).toBeCloseTo(80.56, 2);
  });
});

describe("deductions never argue for a lower payout", () => {
  it("the overlap credits are reported by neither side", () => {
    expect(match.deltas.some((delta) => /overlap/i.test(delta.higherRow.description))).toBe(false);
    expect(match.lowerOnlyRows.some((row) => /overlap/i.test(row.description))).toBe(false);
  });

  it("no finding carries a negative hour value", () => {
    const negative = match.deltas.filter(
      (delta) => (delta.higherRow.labor ?? 0) < 0 || (delta.higherRow.paint ?? 0) < 0
    );
    expect(negative).toEqual([]);
  });

  it("a deduction is recognized by shape, not wording", () => {
    expect(isDeductionRow(parseCccEstimateRows("76 Overlap Major Non-Adj. Panel -0.2")[0])).toBe(true);
    expect(isDeductionRow(parseCccEstimateRows("60 Repl Bumper cover 1 900.00 2.5")[0])).toBe(false);
  });
});

describe("totals", () => {
  const higher = parseCccEstimateTotals(SHOP_TOTALS)!;
  const lower = parseCccEstimateTotals(ERIE_TOTALS)!;
  const totalsDeltas = compareEstimateTotals({ higher, lower });

  it("the gap is $5,102.78", () => {
    expect(higher.grandTotal! - lower.grandTotal!).toBeCloseTo(5102.78, 2);
    const total = totalsDeltas.find((delta) => delta.kind === "total_difference");
    expect(total?.amount).toBeCloseTo(5102.78, 2);
  });

  it("the parts category difference is $317.71", () => {
    const parts = totalsDeltas.find((delta) => /parts/i.test(delta.category));
    expect((parts?.higher?.cost ?? 0) - (parts?.lower?.cost ?? 0)).toBeCloseTo(317.71, 2);
  });

  it("both rate differences surface: $75/$62 body, $60/$41 supplies", () => {
    const rates = totalsDeltas.filter((delta) => delta.kind === "rate_difference");
    const pairs = rates.map((delta) => [delta.higher?.rate, delta.lower?.rate]);
    expect(pairs).toEqual(expect.arrayContaining([[75, 62], [60, 41]]));
  });
});

describe("no dollar figure reaches a reader that the findings do not support", () => {
  const structured = {
    totals: { shop: 8745.29, carrier: 3642.51, gap: 5102.78 },
    carrierOnly: [{ amount: 80.56 }],
    valueDeltas: [
      { shop: 686.05, carrier: 619.71 },
      { shop: 480.22, carrier: 433.81 },
    ],
  };

  it("catches the $180.56 the Customer Report printed twice", () => {
    const fabricated = findFabricatedCurrency(
      "Erie lists a left inner bracket at $180.56 that your shop's estimate does not include.",
      structured
    );
    expect(fabricated).toHaveLength(1);
    expect(fabricated[0].nearest).toBe(80.56);
  });

  it("leaves the correct figures, and honest rounding of them, alone", () => {
    expect(
      findFabricatedCurrency(
        "Your shop's estimate is $8,745.29 and Erie's is $3,642.51 — a gap of roughly $5,100. " +
          "The bracket is $80.56.",
        structured
      )
    ).toEqual([]);
  });
});
