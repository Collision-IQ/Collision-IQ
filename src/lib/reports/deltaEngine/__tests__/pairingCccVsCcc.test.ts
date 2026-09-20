/**
 * RO 21336 (CCC vs CCC — GEICO Supplement of Record 2 with Summary):
 * pairing defects specific to a CCC-to-CCC pair, adjudicated by the
 * 2026-09-20 QA review.
 *
 *  - The SOR's Supplement Summary ledger prints superseded amounts NEGATIVE;
 *    a "-68.40" from it was cited as the carrier's current figure.
 *  - A symmetric RT + LT pair against an RT-only comparison was labelled a
 *    "quantity shortfall (2x here vs 1x paid)" — one side unaddressed is not
 *    a duplicate.
 *  - One item under a colour-variant part number (or a "+25%" suffix) was
 *    counted as fully missing on BOTH sides of the ledger.
 */
import { describe, expect, it } from "vitest";
import { canonKey } from "../estimateNormalize";
import { isChangelogRow, pairAndCompare } from "../deltaPair";
import type { EstimateRow } from "../rowCluster";

function row(spec: {
  line: number;
  desc: string;
  section?: string;
  labor?: number | null;
  paint?: number | null;
  price?: number | null;
  part?: string | null;
  page?: number;
}): EstimateRow {
  const ck = canonKey(spec.desc);
  return {
    page: spec.page ?? 1,
    line: spec.line,
    section: spec.section ? canonKey(spec.section).key : "",
    sectionLabel: spec.section,
    qty: spec.price ? 1 : null,
    price: spec.price ?? null,
    labor: spec.labor ?? null,
    paint: spec.paint ?? null,
    laborClass: "",
    part: spec.part ?? null,
    rawDesc: spec.desc,
    key: ck.key,
    side: ck.side,
    cells: {},
  };
}

describe("the Supplement Summary ledger is history, never a pairing basis", () => {
  it("recognises the ledger's rows by their section", () => {
    expect(isChangelogRow(row({ line: 217, desc: "LT Guide bracket rivet", section: "SUPPLEMENT SUMMARY", price: -68.4 }))).toBe(true);
    expect(isChangelogRow(row({ line: 220, desc: "RT Guide bracket rivet", section: "REAR LAMPS", price: 63.9 }))).toBe(false);
  });

  it("never cites a superseded negative amount as the comparison's figure", () => {
    const subject = [row({ line: 220, desc: "LT Guide bracket rivet", section: "REAR LAMPS", price: 63.9 })];
    const competing = [
      row({ line: 221, desc: "RT Guide bracket rivet", section: "REAR LAMPS", price: 63.9 }),
      row({ line: 217, desc: "LT Guide bracket rivet", section: "SUPPLEMENT SUMMARY", price: -68.4, page: 13 }),
    ];
    const result = pairAndCompare(subject, competing);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].kind).toBe("MISSED");
    expect(result.findings[0].competing).toBeNull();
    // The ledger row is not lower-only scope either.
    expect(result.competingOnly.map((candidate) => candidate.line)).toEqual([221]);
  });
});

describe("a symmetric pair against a one-sided comparison is one side unaddressed", () => {
  const subject = [
    row({ line: 64, desc: "RT R&I front seat", section: "SEATS & TRACKS", labor: 0.5 }),
    row({ line: 65, desc: "LT R&I front seat", section: "SEATS & TRACKS", labor: 0.5 }),
  ];
  const competing = [row({ line: 63, desc: "RT R&I front seat", section: "SEATS & TRACKS", labor: 0.5 })];
  const result = pairAndCompare(subject, competing);

  it("pairs the RT side and reports the LT side as the side the comparison did not price", () => {
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0].subject.line).toBe(64);
    expect(result.findings).toHaveLength(1);
    const missed = result.findings[0];
    expect(missed.kind).toBe("MISSED");
    expect(missed.subject.line).toBe(65);
    expect(missed.otherSideOnCompeting).toBe("right");
    expect(missed.category).toMatch(/left side not on the comparison estimate \(it prices the right side only\)/);
  });

  it("never calls it a quantity shortfall", () => {
    expect(result.findings.some((finding) => finding.kind === "QTY_SHORTFALL")).toBe(false);
  });

  it("keeps the genuine shortfall: the same single-sided operation billed twice on one estimate", () => {
    const twice = pairAndCompare(
      [
        row({ line: 90, desc: "Mask door openings", section: "MISCELLANEOUS OPERATIONS", labor: 0.5 }),
        row({ line: 91, desc: "Mask door openings", section: "MISCELLANEOUS OPERATIONS", labor: 0.5 }),
      ],
      [row({ line: 88, desc: "Mask door openings", section: "MISCELLANEOUS OPERATIONS", labor: 0.5 })]
    );
    expect(twice.findings).toHaveLength(1);
    expect(twice.findings[0].kind).toBe("QTY_SHORTFALL");
    expect(twice.findings[0].category).toMatch(/quantity shortfall \(2x here vs 1x paid\)/);
  });
});

describe("one item under a minor variant is one priced-differently finding, not two misses", () => {
  it("pairs a colour-variant part number", () => {
    const result = pairAndCompare(
      [row({ line: 39, desc: "Seat belt bezel atmosphere", section: "SEAT BELTS", price: 10.38, part: "84924011" })],
      [row({ line: 40, desc: "Seat belt bezel black", section: "SEAT BELTS", price: 10.95, part: "84924010" })]
    );
    expect(result.competingOnly).toEqual([]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].kind).toBe("VALUE_DELTA");
    expect(result.findings[0].nearVariant).toBe(true);
    // One finding carrying the price (and, where the cells differ, the part
    // number) — never a MISSED here and a lower-only line there.
    const price = result.findings[0].deltas.find((delta) => delta.field === "price");
    expect(price).toMatchObject({ subject: 10.38, competing: 10.95 });
  });

  it("pairs the alignment across sections and a markup suffix", () => {
    const result = pairAndCompare(
      [row({ line: 8, desc: "Four wheel suspension alignment", section: "VEHICLE DIAGNOSTICS", price: 268 })],
      [row({ line: 9, desc: "Suspension Alignment +25%", section: "WHEELS", price: 250 })]
    );
    expect(result.competingOnly).toEqual([]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].kind).toBe("VALUE_DELTA");
    const price = result.findings[0].deltas.find((delta) => delta.field === "price");
    expect(price).toMatchObject({ subject: 268, competing: 250 });
  });

  it("does not pair unrelated items or items priced worlds apart", () => {
    const result = pairAndCompare(
      [row({ line: 1, desc: "Seat belt bezel atmosphere", section: "SEAT BELTS", price: 10.38, part: "84924011" })],
      [row({ line: 2, desc: "Seat belt retractor", section: "SEAT BELTS", price: 412.5, part: "84924999" })]
    );
    expect(result.findings[0].kind).toBe("MISSED");
    expect(result.competingOnly).toHaveLength(1);
  });
});
