/**
 * RO 22059 — 2022 Tesla Model S Plaid · VIN 5YJSA1E65NF488007 · USAA claim
 * 012283486000000800001 · Conestoga preliminary vs USAA Supplement of Record 2.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CORRECTED FIXTURE. The work order this was written from states the shop
 * grand total as $22,230.52 and concludes the carrier's supplement is the more
 * generous document, higher by $656.16. Both documents were supplied, and the
 * shop estimate's own ESTIMATE TOTALS block reads:
 *
 *     Parts 12,215.15 · Body 52.7 hrs @ $90.00 4,743.00 · Paint 29.7 @ $90.00
 *     2,673.00 · Mechanical 9.3 @ $175.00 1,627.50 · Aluminum Or Steel 4.5 @
 *     $135.00 607.50 · Paint Supplies 29.7 @ $60.00 1,782.00 · Misc 923.16
 *     Subtotal 24,571.31 · Sales Tax $23,921.41 @ 6% 1,435.28
 *     Grand Total 26,006.59
 *
 * The SOR-2 column of that work order is accurate throughout; the shop column
 * is not, and the gap therefore runs the other way. Every value below is
 * transcribed from the two PDFs, and the category deltas are asserted to
 * reconcile so the fixture cannot drift from them silently.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect } from "vitest";
import { compareClaimIdentity, readClaimIdentity } from "../claimIdentityGate";

/** Transcribed from each document's ESTIMATE TOTALS block. */
const SHOP = {
  parts: 12215.15,
  bodyLabor: { hours: 52.7, rate: 90.0, cost: 4743.0 },
  paintLabor: { hours: 29.7, rate: 90.0, cost: 2673.0 },
  mechanical: { hours: 9.3, rate: 175.0, cost: 1627.5 },
  aluminumOrSteel: { hours: 4.5, rate: 135.0, cost: 607.5 },
  paintSupplies: { hours: 29.7, rate: 60.0, cost: 1782.0 },
  miscellaneous: 923.16,
  subtotal: 24571.31,
  taxBasis: 23921.41,
  tax: 1435.28,
  grandTotal: 26006.59,
} as const;

const SOR2 = {
  parts: 11976.71,
  bodyLabor: { hours: 64.1, rate: 95.0, cost: 6089.5 },
  paintLabor: { hours: 21.8, rate: 95.0, cost: 2071.0 },
  mechanical: { hours: 4.7, rate: 110.0, cost: 517.0 },
  aluminumOrSteel: null, // the category is absent entirely
  paintSupplies: { hours: null, rate: null, cost: 800.0 }, // flat, no basis
  miscellaneous: 137.0,
  subtotal: 21591.21,
  taxBasis: 21591.21,
  tax: 1295.47,
  grandTotal: 22886.68,
  deductible: 1000.0,
  netToShop: 21886.68,
} as const;

describe("the documents' own arithmetic closes", () => {
  it("every priced category is hours x rate", () => {
    for (const lane of [
      SHOP.bodyLabor,
      SHOP.paintLabor,
      SHOP.mechanical,
      SHOP.aluminumOrSteel,
      SHOP.paintSupplies,
      SOR2.bodyLabor,
      SOR2.paintLabor,
      SOR2.mechanical,
    ]) {
      expect(lane.hours * lane.rate).toBeCloseTo(lane.cost, 2);
    }
  });

  it("categories plus tax reach each grand total", () => {
    const shopCategories =
      SHOP.parts +
      SHOP.bodyLabor.cost +
      SHOP.paintLabor.cost +
      SHOP.mechanical.cost +
      SHOP.aluminumOrSteel.cost +
      SHOP.paintSupplies.cost +
      SHOP.miscellaneous;
    expect(shopCategories).toBeCloseTo(SHOP.subtotal, 2);
    expect(SHOP.subtotal + SHOP.tax).toBeCloseTo(SHOP.grandTotal, 2);

    const sorCategories =
      SOR2.parts +
      SOR2.bodyLabor.cost +
      SOR2.paintLabor.cost +
      SOR2.mechanical.cost +
      SOR2.paintSupplies.cost +
      SOR2.miscellaneous;
    expect(sorCategories).toBeCloseTo(SOR2.subtotal, 2);
    expect(SOR2.subtotal + SOR2.tax).toBeCloseTo(SOR2.grandTotal, 2);
    expect(SOR2.grandTotal - SOR2.deductible).toBeCloseTo(SOR2.netToShop, 2);
  });

  it("the supplement chain reaches the carrier's own total", () => {
    // CUMULATIVE EFFECTS OF SUPPLEMENT(S), printed on the SOR-2.
    expect(11459.88 + 8894.3 + 2532.5).toBeCloseTo(SOR2.grandTotal, 2);
  });
});

describe("the gap runs from the shop DOWN to the carrier", () => {
  it("the shop estimate is the higher document, by $3,119.91", () => {
    expect(SHOP.grandTotal).toBeGreaterThan(SOR2.grandTotal);
    expect(SHOP.grandTotal - SOR2.grandTotal).toBeCloseTo(3119.91, 2);
  });

  it("the subtotal delta is -$2,980.10 and the categories reconcile to it", () => {
    const deltas = [
      SOR2.parts - SHOP.parts,
      SOR2.bodyLabor.cost - SHOP.bodyLabor.cost,
      SOR2.paintLabor.cost - SHOP.paintLabor.cost,
      SOR2.mechanical.cost - SHOP.mechanical.cost,
      0 - SHOP.aluminumOrSteel.cost,
      SOR2.paintSupplies.cost - SHOP.paintSupplies.cost,
      SOR2.miscellaneous - SHOP.miscellaneous,
    ];
    const sum = deltas.reduce((total, value) => total + value, 0);
    expect(sum).toBeCloseTo(SOR2.subtotal - SHOP.subtotal, 2);
    expect(sum).toBeCloseTo(-2980.1, 2);
  });

  it("body labor is the only category the carrier pays MORE on", () => {
    expect(SOR2.bodyLabor.cost - SHOP.bodyLabor.cost).toBeCloseTo(1346.5, 2);
  });
});

describe("the three structural findings, each visible only in the totals block", () => {
  it("the carrier carries no aluminum category at all", () => {
    expect(SHOP.aluminumOrSteel).not.toBeNull();
    expect(SOR2.aluminumOrSteel).toBeNull();
  });

  it("the carrier's paint supplies are a flat figure with no hours and no rate", () => {
    expect(SOR2.paintSupplies.hours).toBeNull();
    expect(SOR2.paintSupplies.rate).toBeNull();
    // The shop's is computed; that contrast is the finding.
    expect(SHOP.paintSupplies.hours! * SHOP.paintSupplies.rate!).toBeCloseTo(
      SHOP.paintSupplies.cost,
      2
    );
  });

  it("the two documents tax different bases — the shop excludes $649.90 of sublet", () => {
    expect(SHOP.subtotal - SHOP.taxBasis).toBeCloseTo(649.9, 2);
    expect(SOR2.taxBasis).toBeCloseTo(SOR2.subtotal, 2); // carrier taxes everything
  });
});

describe("the identity gate passes this pair", () => {
  const shopHeader =
    "Insured:REARDON, CHRISTOPHERPolicy #:Claim #:012283486000000800001\n" +
    "RO Number: 22059\n2022 TESL Model S Plaid AWD 4D\nVIN:    5YJSA1E65NF488007Interior Color:WHITE";
  const sorHeader =
    "Claim #:\nWorkfile ID:\n012283486000000800001\ncbf21b7c\n" +
    "Insured:Christopher ReardonOwner Policy #:012283486\n2022 TESL Model S Plaid AWD 4D\n" +
    "VIN:5YJSA1E65NF488007Interior Color:WHITE";

  it("agrees on VIN and claim number, and blocks nothing", () => {
    const verdict = compareClaimIdentity(readClaimIdentity(shopHeader), readClaimIdentity(sorHeader));
    expect(verdict.blocked).toBe(false);
    expect(verdict.agreed).toEqual(expect.arrayContaining(["vin", "claim number"]));
  });
});
