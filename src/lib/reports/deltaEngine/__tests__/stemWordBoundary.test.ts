/**
 * A canonical stem identifies an operation only when it lands on WHOLE WORDS.
 *
 * RO 22116 finding 61 paired the shop's "Cover to protect interior during
 * repair" ($5.00 + 0.5 hr) against the carrier's "Color Tint" ($0.00 + 0.5
 * paint) — two descriptions with no word in common. The cause was not a weak
 * similarity threshold. canonKey squashes a description to letters, and
 *
 *     "protect interior"  ->  "PROTECTINTERIOR"
 *
 * contains TINT, at pro-tec-TINT-erior. The STEMS pass tested stems as bare
 * substrings, so the row typed as COLORTINT. Everything downstream followed
 * correctly from that one wrong key: it paired with the carrier's real Color
 * Tint line, pulled the shop's actual "Tint color" line into the group, and
 * reported a $0.00 counterpart and a phantom "2x here vs 1x paid".
 *
 * Long stems keep the substring test on purpose — they exist for glued
 * documents whose word boundaries are already destroyed.
 */
import { describe, it, expect } from "vitest";
import { canonKey } from "../estimateNormalize";

describe("a stem may not be read out of the middle of a word", () => {
  it("does not type the RO 22116 cover row as Color Tint", () => {
    const key = canonKey("Cover to protect interior during repair").key;
    expect(key).not.toBe("COLORTINT");
    expect(canonKey("# Cover to protect interior during repair").key).not.toBe("COLORTINT");
  });

  it("keeps the cover row distinguishable from the carrier's tint row", () => {
    expect(canonKey("Cover to protect interior during repair").key).not.toBe(
      canonKey("Color Tint").key
    );
  });

  it("other words that merely contain a stem are unaffected", () => {
    // "PROTECTINTERIOR" is the live one; these are the same shape.
    expect(canonKey("Protect interior trim").key).not.toBe("COLORTINT");
    expect(canonKey("Paint interior surfaces").key).not.toBe("COLORTINT");
  });
});

describe("real stems still resolve, in either word order", () => {
  it("Color Tint and Tint color are one operation", () => {
    expect(canonKey("Color Tint").key).toBe("COLORTINT");
    expect(canonKey("Tint color").key).toBe("COLORTINT");
    expect(canonKey("Tint color > Three stage let down panel").key).toBe("COLORTINT");
  });

  it("the other short stems keep working", () => {
    expect(canonKey("Denib and polish").key).toBe("SANDPOLISH");
    expect(canonKey("Finish sand & polish").key).toBe("SANDPOLISH");
  });

  it("long stems keep matching glued text, which is why they are long", () => {
    // No word boundaries survive in a corrupted layer; an 8+ character stem is
    // specific enough that a substring hit is not a coincidence.
    expect(canonKey("HAZARDOUSWASTEREMOVAL").key).toBe("HAZARDOUSWASTE");
    expect(canonKey("Hazardous waste").key).toBe("HAZARDOUSWASTE");
    expect(canonKey("Cavity wax").key).toBe("CAVITYWAX");
  });
});
