/**
 * Part-number recognition is SHAPE, never one producer's format — and the
 * supplement sequence marker is not part of an operation's identity.
 *
 * Both defects were found the same way: the typed engine paired 17 of 139 rows
 * on RO 22059 where the text lane paired 82. Root causes were (a) `extractPart`
 * hardcoded to `PT\d{8}[A-Z]`, the CCC/Rivian form carried by RO 22047 — the
 * fixture the engine was tuned on, which is exactly why it stayed invisible —
 * and (b) supplement markers surviving into the canonical key, so the shop's
 * `INFOLABELVECI` never met the carrier's `SREPLINFOLABELVECI`.
 *
 * The first fix, written loosely, cost three RO 22047 rows: "letters + digits"
 * swallows `Tape-3M`, `06347-Per` and the glued `TrimMaskingTape-3M06347`, and
 * consuming a description word as a part strips the operation out of the row.
 * These guards hold both edges.
 */
import { describe, it, expect } from "vitest";
import { canonKey, extractPart, looksLikePartNumber } from "../estimateNormalize";
import { parsePage, type ColRanges, type RowParseState, type Word } from "../rowCluster";

describe("a part number is recognized by shape, on any producer", () => {
  const PART_NUMBERS = [
    "156954500F", // Tesla
    "1562551E0A",
    "160818100B",
    "146292700C",
    "1073678S0B",
    "63217420123", // BMW
    "51127420665",
    "51127420665A",
    "C25J75", // short, letter-led
    "167-880-44-09", // Mercedes, dash-grouped
    "1234.5678", // aftermarket catalog form
  ];

  for (const value of PART_NUMBERS) {
    it(`accepts ${value}`, () => {
      expect(looksLikePartNumber(value)).toBe(true);
      expect(extractPart(value).part).toBe(value);
    });
  }

  it("still splits the CCC glued qty form it was originally built for", () => {
    expect(extractPart("PT00015376B001")).toEqual({ part: "PT00015376B001", trailing: "" });
    expect(extractPart("PT00015376B").part).toBe("PT00015376B");
  });
});

describe("description text is never consumed as a part number", () => {
  const PROSE = [
    "Tape-3M",
    "06347-Per",
    "TrimMaskingTape-3M06347", // the glued run that dropped RO 22047 line 85
    "CavityWaxPlus-3M08852",
    "4WheelAlignment",
    "Ounces",
    "Masking",
  ];

  for (const value of PROSE) {
    it(`rejects ${value}`, () => {
      expect(looksLikePartNumber(value)).toBe(false);
      expect(extractPart(value).part).toBeNull();
    });
  }

  it("rejects money, which shares the digit shape", () => {
    expect(looksLikePartNumber("1,234.56")).toBe(false);
    expect(looksLikePartNumber("$8,745.29")).toBe(false);
  });

  it("rejects a token too short to be a catalog number", () => {
    expect(looksLikePartNumber("3M")).toBe(false);
    expect(looksLikePartNumber("08308")).toBe(false);
  });
});

describe("the column the producer printed a token in outranks its shape", () => {
  const COLS: ColRanges = { qty: [300, 340], price: [360, 420], labor: [440, 490], paint: [510, 560] };
  const state = (): RowParseState => ({ section: "", prev: null, pendingStub: null, lastWasNote: false });
  const word = (text: string, x: number, top: number): Word => ({
    text,
    x0: x,
    x1: x + text.length * 5,
    top,
    bottom: top + 9,
  });

  it("a value cell whose digits look like a part number stays a value", () => {
    // 121500 in the price column is $121,500-shaped measured data, not a part.
    const words = [
      word("41", 40, 12),
      word("Repl", 60, 12),
      word("Quarter", 95, 12),
      word("panel", 140, 12),
      word("1", 310, 12),
      word("121500", 370, 12),
    ];
    const [row] = parsePage(words, 1, COLS, state());
    expect(row.price).toBe(121500);
    expect(row.part).toBeNull();
  });

  it("the same token in the description column is read as the part", () => {
    const words = [
      word("41", 40, 12),
      word("Repl", 60, 12),
      word("Quarter", 95, 12),
      word("121500", 140, 12),
      word("1", 310, 12),
      word("900.00", 370, 12),
    ];
    const [row] = parsePage(words, 1, COLS, state());
    expect(row.part).toBe("121500");
    expect(row.price).toBe(900);
  });
});

describe("the supplement sequence marker is not part of an operation's identity", () => {
  it("a supplement line keys the same as the original line", () => {
    expect(canonKey("S01 Repl Information labels").key).toBe(canonKey("Repl Information labels").key);
    expect(canonKey("S2 Rpr Bumper cover").key).toBe(canonKey("Rpr Bumper cover").key);
  });

  it("the marker does not block the operation-code stripper", () => {
    expect(canonKey("S01 Repl Information labels").key).not.toMatch(/^S/);
  });

  it("a real operation that merely begins with S is untouched", () => {
    expect(canonKey("Subl 4 Wheel Alignment").key).toBe(canonKey("Sublet 4 Wheel Alignment").key);
    expect(canonKey("Seam sealer").key).toContain("SEALER");
  });
});
