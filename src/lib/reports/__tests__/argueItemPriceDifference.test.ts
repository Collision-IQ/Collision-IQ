/**
 * "Items worth arguing" values a paired line at its labor AND its price
 * difference, as the gross view and the citation copy already do.
 *
 * RO 22120 review: our wheel, "Repl LT/Front Wheel, alloy 19"" at $700.00
 * with 0.3 hr M, was paired with the carrier's "Subl LT/Front Wheel, alloy
 * 19"" at $189.99 with no hours. The citation copy read "short $562.51"; the
 * dispute report valued the same pair at its 0.3 hr only ($52.50) and folded
 * it into the "smaller items" it does not list.
 *
 * Lines are shaped like the prints' own; part numbers are synthetic.
 */
import { describe, expect, it } from "vitest";
import { argueItems, type MatcherPair } from "../appraisalSummary/argueItems";
import type { Estimate, EstimateLine } from "../appraisalSummary/types";

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

const items = (shopLines: EstimateLine[], carrierLines: EstimateLine[], pairs: MatcherPair[]) =>
  argueItems({
    shop: estimate("shop", shopLines),
    carrier: estimate("carrier", carrierLines),
    groups: [],
    usedShop: new Set(),
    flags: [],
    pairs,
  });

describe("a paired line whose prices differ is argued at labor plus the price difference", () => {
  const shopLines: EstimateLine[] = [
    { line: 30, oper: "Repl", desc: 'LT/Front Wheel, alloy 19"', partNumber: "0000001A", price: 700, hours: 0.3, laborCat: "mechanical" },
    { line: 32, oper: "Repl", desc: 'LT/Rear Wheel, alloy 19"', partNumber: "0000001A", price: 700, hours: 0.3, laborCat: "body" },
  ];
  const carrierLines: EstimateLine[] = [
    { line: 24, oper: "Subl", desc: 'LT/Front Wheel, alloy 19"', price: 189.99 },
    { line: 25, oper: "Subl", desc: 'LT/Rear Wheel, alloy 19"', price: 189.99 },
  ];
  const pairs: MatcherPair[] = [
    { kind: "reduced", shopLines: [30], carrierLine: 24 },
    { kind: "reduced", shopLines: [32], carrierLine: 25 },
  ];

  it("replace at $700.00 against a $189.99 sublet repair is $562.51 (0.3 hr M) and $537.01 (0.3 hr body)", () => {
    const result = items(shopLines, carrierLines, pairs);
    const front = result.find((i) => i.shopLines.includes(30));
    const rear = result.find((i) => i.shopLines.includes(32));
    expect(front).toMatchObject({ strength: "Needs proof", value: 562.51, hours: 0.3, carrierLines: [24] });
    expect(rear).toMatchObject({ strength: "Needs proof", value: 537.01, hours: 0.3, carrierLines: [25] });
    // Both prices are stated, so the worth can be checked against the prints.
    expect(front?.detail).toBe("Ours 0.3 hr, $700.00 (L30), theirs 0.0 hr, $189.99 (L24 Subl).");
  });

  it("a price-only difference is an item too; equal prices keep the hours-only wording", () => {
    const result = items(
      [
        { line: 35, oper: "", desc: "Four wheel suspension alignment", price: 268 },
        { line: 59, oper: "Rpr", desc: "LT Upper cover", hours: 3.0, laborCat: "body" },
      ],
      [
        { line: 31, oper: "", desc: "Four wheel alignment", price: 98 },
        { line: 39, oper: "Rpr", desc: "LT Upper cover", hours: 2.0, laborCat: "body" },
      ],
      [
        { kind: "reduced", shopLines: [35], carrierLine: 31 },
        { kind: "reduced", shopLines: [59], carrierLine: 39 },
      ]
    );
    expect(result.find((i) => i.shopLines.includes(35))).toMatchObject({ value: 170, hours: 0 });
    expect(result.find((i) => i.shopLines.includes(59))?.detail).toBe("Ours 3.0 hr (L59), theirs 2.0 hr (L39 Rpr).");
  });

  it("their higher price nets against our extra hours, as the gross view nets it", () => {
    const result = items(
      [{ line: 40, oper: "Repl", desc: "Bracket", price: 50, hours: 1.0, laborCat: "body" }],
      [{ line: 20, oper: "Repl", desc: "Bracket", price: 200, hours: 0.5, laborCat: "body" }],
      [{ kind: "reduced", shopLines: [40], carrierLine: 20 }]
    );
    // 0.5 hr x $90 = $45.00 more labor on ours, $150.00 more price on theirs.
    expect(result.find((i) => i.shopLines.includes(40))).toBeUndefined();
  });
});
