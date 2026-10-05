/**
 * The gross short-pay view never pairs two lines at different printed
 * positions.
 *
 * On a CCC ONE shop estimate against the carrier's SOR, the matcher left our
 * "RT/Front R&I wheel" and "RT/Rear R&I wheel" (0.2 hr M each) unpaired, and
 * the carrier's sheet carried only "LT/Front R&I wheel" and "LT/Rear R&I
 * wheel" (0.1 hr each). The component-name fallback strips the side, so it
 * paired RT with LT and reported each as "short $26" on one line, when the two
 * sheets actually wrote wheels on opposite sides: ours $35 not on theirs,
 * theirs $9 not on ours. The same view paired our side-less "Lower cover"
 * replacement with their "LT Upper cover" repair by shared words, stamping a
 * $600 part against a repair line.
 *
 * Every pass after the matcher's own pairs (part number, component name, word
 * overlap) now refuses a pair whose printed positions conflict on any axis
 * (front/rear, left/right, upper/lower, inner/outer), read from the section and
 * the description. A line that names no position on an axis still pairs, and
 * lines the matcher called missing still pair through the fallback when they
 * are the same line at the same position.
 *
 * The "Check this first" cross-sheet lookups (part-number variant, part
 * without labor, reuse mismatch, labor category) find "the same line on their
 * sheet" with the same side-less name, and take the same guard: a flag names
 * the line at the same printed position, never its opposite-side twin.
 *
 * All lines, part numbers and prices here are synthetic, in the shape the
 * prints carry.
 */
import { describe, expect, it } from "vitest";
import type { MatcherPair } from "../appraisalSummary/argueItems";
import type { GapLedger } from "../appraisalSummary/gapLedger";
import { integrityChecks } from "../appraisalSummary/integrityChecks";
import { assignUnits, buildShortPayView } from "../appraisalSummary/shortPayView";
import type { Estimate, EstimateLine } from "../appraisalSummary/types";

const BODY = 90;
const MECH = 175;
const PAINT = 50;

function estimate(role: Estimate["role"], lines: EstimateLine[]): Estimate {
  return {
    role,
    fileName: `${role}.pdf`,
    vehicle: "Synthetic vehicle",
    totals: {
      parts: 0,
      misc: 0,
      labor: [
        { cat: "body", label: "Body Labor", hours: 1, rate: BODY, cost: BODY },
        { cat: "paint", label: "Paint Labor", hours: 1, rate: PAINT, cost: PAINT },
        { cat: "mechanical", label: "Mechanical Labor", hours: 1, rate: MECH, cost: MECH },
      ],
      paintSupplies: { hours: 0, rate: 0, cost: 0 },
      subtotal: 0,
      tax: 0,
      grandTotal: 0,
    },
    lines,
  };
}

function ledger(gap = 0): GapLedger {
  return { paintMaterials: 0, otherMaterials: 0, laborRate: 0, tax: 0, gap, shopLineRead: null } as unknown as GapLedger;
}

/** The matcher's verdict for shop lines it found no carrier line for. */
const missing = (...shopLines: number[]): MatcherPair[] => shopLines.map((n) => ({ kind: "missing", shopLines: [n] }));

const run = (shopLines: EstimateLine[], carrierLines: EstimateLine[], pairs: MatcherPair[] = []) =>
  assignUnits({ shop: estimate("shop", shopLines), carrier: estimate("carrier", carrierLines), ledger: ledger(), groups: [], pairs });

const unitFor = (units: ReturnType<typeof run>["units"], side: "shop" | "carrier", line: number) =>
  units.find((u) => (side === "shop" ? u.shopLines : u.carrierLines).includes(line));

describe("short-pay view: no pairing across printed positions", () => {
  const shopWheels: EstimateLine[] = [
    { line: 29, oper: "R&I", desc: "RT/Front R&I wheel", hours: 0.2, laborCat: "mechanical", section: "WHEELS" },
    { line: 31, oper: "R&I", desc: "RT/Rear R&I wheel", hours: 0.2, laborCat: "mechanical", section: "WHEELS" },
  ];
  const carrierWheels: EstimateLine[] = [
    { line: 28, oper: "R&I", desc: "LT/Front R&I wheel", hours: 0.1, section: "WHEELS" },
    { line: 29, oper: "R&I", desc: "LT/Rear R&I wheel", hours: 0.1, section: "WHEELS" },
  ];

  it("leaves our RT wheel R&I and their LT wheel R&I one-sided", () => {
    const { units, shopToCarrier } = run(shopWheels, carrierWheels, missing(29, 31));
    expect(shopToCarrier.size).toBe(0);
    expect(unitFor(units, "shop", 29)).toMatchObject({ shopLines: [29], carrierLines: [], diff: 35 });
    expect(unitFor(units, "shop", 31)).toMatchObject({ shopLines: [31], carrierLines: [], diff: 35 });
    expect(unitFor(units, "carrier", 28)).toMatchObject({ shopLines: [], carrierLines: [28], diff: -9 });
    expect(unitFor(units, "carrier", 29)).toMatchObject({ shopLines: [], carrierLines: [29], diff: -9 });
  });

  it("reports the gross figures of two one-sided wheel pairs, not a $26 short-pay on each", () => {
    const view = buildShortPayView({
      shop: estimate("shop", shopWheels),
      carrier: estimate("carrier", carrierWheels),
      ledger: ledger(52),
      groups: [],
      pairs: missing(29, 31),
    });
    expect(view).not.toBeNull();
    expect(view!.shortPaid).toBe(70);
    expect(view!.carrierOver).toBe(18);
    expect(view!.gap).toBe(52);
  });

  it("pairs our LT wheel with their LT wheel when their sheet lists the RT one first", () => {
    const { shopToCarrier } = run(
      [{ line: 5, oper: "R&I", desc: "LT/Front R&I wheel", hours: 0.2, laborCat: "mechanical" }],
      [
        { line: 7, oper: "R&I", desc: "RT/Front R&I wheel", hours: 0.1 },
        { line: 8, oper: "R&I", desc: "LT/Front R&I wheel", hours: 0.1 },
      ],
      missing(5)
    );
    expect(shopToCarrier.get(5)).toBe(8);
  });

  it("pairs one part number written front and rear by the section it prints under", () => {
    const { shopToCarrier } = run(
      [
        { line: 10, oper: "Repl", desc: "Hub bolt", partNumber: "SYN-1000-A", price: 4, hours: 0.2, section: "FRONT SUSPENSION" },
        { line: 20, oper: "Repl", desc: "Hub bolt", partNumber: "SYN-1000-A", price: 4, hours: 0.4, section: "REAR SUSPENSION" },
      ],
      [
        { line: 30, oper: "Repl", desc: "Hub bolt", partNumber: "SYN1000A", price: 4, hours: 0.3, section: "REAR SUSPENSION" },
        { line: 40, oper: "Repl", desc: "Hub bolt", partNumber: "SYN1000A", price: 4, hours: 0.1, section: "FRONT SUSPENSION" },
      ],
      missing(10, 20)
    );
    expect(shopToCarrier.get(10)).toBe(40);
    expect(shopToCarrier.get(20)).toBe(30);
  });

  it("does not pair a side-less lower cover replacement with an upper cover repair", () => {
    const { units, shopToCarrier } = run(
      [{ line: 61, oper: "Repl", desc: "Lower cover w/o Performance", partNumber: "SYN-2000-B", price: 600, section: "REAR BUMPER" }],
      [{ line: 39, oper: "Rpr", desc: "LT Upper cover w/o Performace", hours: 3, paintHours: 1.8, section: "REAR BUMPER" }]
    );
    expect(shopToCarrier.size).toBe(0);
    expect(unitFor(units, "shop", 61)).toMatchObject({ shopLines: [61], carrierLines: [], diff: 600 });
    expect(unitFor(units, "carrier", 39)).toMatchObject({ shopLines: [], carrierLines: [39], diff: -360 });
  });

  it("still pairs a line that names no position with one that names it (alignment under a front section)", () => {
    const { shopToCarrier } = run(
      [{ line: 35, oper: "Subl", desc: "Four wheel suspension alignment", price: 268, section: "WHEELS" }],
      [{ line: 31, oper: "Subl", desc: "Four Wheel Alignment", price: 98, section: "WHEELS & FRONT SUSPENSION" }]
    );
    expect(shopToCarrier.get(35)).toBe(31);
  });

  it("still rescues identical same-side lines the matcher called missing", () => {
    const { units, shopToCarrier } = run(
      [
        { line: 160, oper: "R&I", desc: "R&I LT Front shield battery", hours: 0.3 },
        { line: 136, oper: "Repl", desc: "Susp subframe bolt", partNumber: "SYN3000A", price: 12, hours: 0.1 },
      ],
      [
        { line: 123, oper: "R&I", desc: "R&I LT Front shield battery", hours: 0.3 },
        { line: 104, oper: "Repl", desc: "Subframe bolt", partNumber: "syn3000-a", price: 12, hours: 0.1 },
      ],
      missing(160, 136)
    );
    expect(shopToCarrier.get(160)).toBe(123);
    expect(shopToCarrier.get(136)).toBe(104);
    expect(units).toEqual([]);
  });
});

describe("check-this-first lookups: the counterpart at the same printed position", () => {
  const flagOf = (shopLines: EstimateLine[], carrierLines: EstimateLine[], kind: string) =>
    integrityChecks(estimate("shop", shopLines), estimate("carrier", carrierLines)).filter((f) => f.kind === kind);

  it("labor category: our RT wheel R&I is compared with their RT line, not the LT line listed first", () => {
    const flags = flagOf(
      [{ line: 14, oper: "R&I", desc: "RT/Rear R&I wheel", hours: 0.2, laborCat: "body" }],
      [
        { line: 6, oper: "R&I", desc: "LT/Rear R&I wheel", hours: 0.2, laborCat: "mechanical" },
        { line: 7, oper: "R&I", desc: "RT/Rear R&I wheel", hours: 0.2, laborCat: "mechanical" },
      ],
      "laborCategoryMismatch"
    );
    expect(flags.map((f) => f.lines)).toEqual([{ shop: [14], carrier: [7] }]);
  });

  it("part without labor: their rear part is not answered by our front line of the same number", () => {
    const flags = flagOf(
      [
        { line: 10, oper: "Repl", desc: "Hub bolt", partNumber: "SYN-1000-A", price: 4, hours: 0.2, section: "FRONT SUSPENSION" },
        { line: 20, oper: "Repl", desc: "Hub bolt", partNumber: "SYN-1000-A", price: 4, hours: 0.4, section: "REAR SUSPENSION" },
      ],
      [{ line: 30, oper: "Repl", desc: "Hub bolt", partNumber: "SYN1000A", price: 4, section: "REAR SUSPENSION" }],
      "partWithoutLabor"
    );
    expect(flags.map((f) => f.lines)).toEqual([{ shop: [20], carrier: [30] }]);
  });

  it("reuse mismatch: their LT part that cannot be reused is set against our LT R&I", () => {
    const flags = flagOf(
      [
        { line: 3, oper: "R&I", desc: "RT Upper bracket", hours: 0.2 },
        { line: 4, oper: "R&I", desc: "LT Upper bracket", hours: 0.2 },
      ],
      [{ line: 9, oper: "Repl", desc: "LT Upper bracket", partNumber: "SYN-4000-C", price: 20, note: "Part cannot be reused." }],
      "reuseMismatch"
    );
    expect(flags.map((f) => f.lines)).toEqual([{ shop: [4], carrier: [9] }]);
  });

  it("part-number variant: their LT part is compared with our LT part, not the RT one", () => {
    const flags = flagOf(
      [
        { line: 21, oper: "Repl", desc: "RT Outer support", partNumber: "SYN-5000-R", price: 40 },
        { line: 22, oper: "Repl", desc: "LT Outer support", partNumber: "SYN-5000-L", price: 40 },
      ],
      [{ line: 31, oper: "Repl", desc: "LT Outer support", partNumber: "SYN-5001-L", price: 42 }],
      "partNumberVariant"
    );
    expect(flags.map((f) => f.lines)).toEqual([{ shop: [22], carrier: [31] }]);
  });
});
