/**
 * "Clean up our own sheet" duplicate checks honour printed position.
 *
 * RO 22120 (shop preliminary vs carrier SOR 2, reviewed 2026-10-04): the
 * Appraisal Dispute Report told the shop to "keep one" of six pairs that are
 * two locations: front and rear wheels (same part number), front and rear
 * suspension hub bolts, and the front and rear bumpers' O/H, primer masking
 * and wiring protection. The position is printed in the description
 * ("LT/Front" vs "LT/Rear") or only in the section header ("FRONT BUMPER &
 * GRILLE" vs "REAR BUMPER"). The lines below are those shapes, de-identified
 * (synthetic part numbers and prices); the section names are CCC's.
 */
import { describe, expect, it } from "vitest";
import { integrityChecks } from "../appraisalSummary/integrityChecks";
import type { Estimate, EstimateLine } from "../appraisalSummary/types";

const estimate = (role: Estimate["role"], lines: EstimateLine[]): Estimate => ({
  role,
  fileName: `${role}.pdf`,
  vehicle: "Synthetic test vehicle",
  totals: {
    parts: 0,
    misc: 0,
    labor: [],
    paintSupplies: { hours: 0, rate: 0, cost: 0 },
    subtotal: 0,
    tax: 0,
    grandTotal: 0,
  },
  lines,
});

const line = (n: number, desc: string, cells: Partial<EstimateLine> = {}): EstimateLine => ({ line: n, desc, ...cells });

const flagged = (shop: EstimateLine[], carrier: EstimateLine[] = []) =>
  integrityChecks(estimate("shop", shop), estimate("carrier", carrier))
    .filter((f) => f.kind === "duplicatePartNumber" || f.kind === "duplicateOperation")
    .map((f) => ({ kind: f.kind, side: f.side, lines: (f.lines.shop ?? f.lines.carrier ?? []).join(",") }));

describe("duplicate checks: two printed positions are two locations", () => {
  it("one part number on the front and rear wheel (position in the description) is not a duplicate", () => {
    const wheel = { oper: "Repl", partNumber: "SYN-WHEEL-1", qty: 1, price: 700, hours: 0.3 };
    expect(
      flagged([
        line(30, 'LT/Front Wheel, alloy 19"', { ...wheel, section: "WHEELS" }),
        line(32, 'LT/Rear Wheel, alloy 19"', { ...wheel, section: "WHEELS" }),
      ])
    ).toEqual([]);
  });

  it("one part number under FRONT and REAR SUSPENSION (position in the section only) is not a duplicate", () => {
    const bolt = { oper: "Repl", partNumber: "SYN-BOLT-1", qty: 3, price: 10.5 };
    expect(
      flagged([
        line(41, "LT Hub assy bolt", { ...bolt, section: "FRONT SUSPENSION" }),
        line(52, "LT Hub assy mount bolt", { ...bolt, section: "REAR SUSPENSION" }),
      ])
    ).toEqual([]);
  });

  it("the same operation on the front and rear bumper is not written twice", () => {
    expect(
      flagged([
        line(4, "bumper assy", { oper: "O/H", hours: 3.0, section: "FRONT BUMPER & GRILLE" }),
        line(10, "Mask for primer", { price: 5, hours: 0.3, manual: true, section: "FRONT BUMPER & GRILLE" }),
        line(14, "Set back, secure Protect wiring & connectors", { price: 2.5, hours: 0.3, manual: true, section: "FRONT BUMPER & GRILLE" }),
        line(56, "bumper assy", { oper: "O/H", hours: 3.7, section: "REAR BODY & FLOOR" }),
        line(62, "Mask for primer", { price: 5, hours: 0.3, manual: true, section: "REAR BUMPER" }),
        line(65, "Set back, secure Protect wiring & connectors", { price: 2.5, hours: 0.3, manual: true, section: "REAR BUMPER" }),
      ])
    ).toEqual([]);
  });

  it("their front and rear wheel covers are not a duplicate either", () => {
    const cover = { oper: "Repl", partNumber: "SYN-COVER-1", qty: 1, price: 51 };
    expect(
      flagged(
        [],
        [line(26, 'LT/Front Wheel cover 19"', { ...cover, section: "WHEELS" }), line(27, 'LT/Rear Wheel cover 19"', { ...cover, section: "WHEELS" })]
      )
    ).toEqual([]);
  });

  it("a repeat at the same position is still flagged", () => {
    expect(
      flagged([
        line(10, "Mask for primer", { price: 5, hours: 0.3, section: "FRONT BUMPER & GRILLE" }),
        line(12, "Mask for primer", { price: 5, hours: 0.3, section: "FRONT BUMPER & GRILLE" }),
      ])
    ).toEqual([{ kind: "duplicateOperation", side: "shop", lines: "10,12" }]);
  });

  it("a repeat with no position on either line is still flagged (no section read, as on stored rows)", () => {
    expect(
      flagged([line(20, "Mask for primer", { price: 5, hours: 0.3 }), line(21, "Mask for primer", { price: 5, hours: 0.3 })])
    ).toEqual([{ kind: "duplicateOperation", side: "shop", lines: "20,21" }]);
    const part = { oper: "Repl", partNumber: "SYN-CLIP-1", qty: 1, price: 4 };
    expect(flagged([line(30, "Clip", part), line(31, "Retainer clip", part)])).toEqual([
      { kind: "duplicatePartNumber", side: "shop", lines: "30,31" },
    ]);
  });

  it("a position only one line names says nothing, so the pair is still flagged", () => {
    expect(
      flagged([
        line(10, "Mask for primer", { price: 5, hours: 0.3, section: "REAR BUMPER" }),
        line(70, "Mask for primer", { price: 5, hours: 0.3, section: "MISCELLANEOUS OPERATIONS" }),
      ])
    ).toEqual([{ kind: "duplicateOperation", side: "shop", lines: "10,70" }]);
  });

  it("of three, only the lines sharing a position are listed", () => {
    const op = { price: 5, hours: 0.3 };
    expect(
      flagged([
        line(10, "Mask for primer", { ...op, section: "FRONT BUMPER & GRILLE" }),
        line(11, "Mask for primer", { ...op, section: "FRONT BUMPER & GRILLE" }),
        line(62, "Mask for primer", { ...op, section: "REAR BUMPER" }),
      ])
    ).toEqual([{ kind: "duplicateOperation", side: "shop", lines: "10,11" }]);
  });
});
