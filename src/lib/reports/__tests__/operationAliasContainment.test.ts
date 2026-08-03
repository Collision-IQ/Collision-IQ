/**
 * An alias resolves even when the producer welds note text onto the operation
 * wording.
 *
 * RO 22059: the carrier printed "Urethane Kit... BETASEAL, 3 KITS" against the
 * shop's "BetaSeal Express Urethane". BOTH wordings were already in the alias
 * table under URETHANE_ADHESIVE — and the pair still failed, because lookup
 * demanded exact normalized equality and the trailing note broke it. The report
 * carried the same windshield adhesive as one missing operation AND one
 * carrier-only line.
 *
 * Containment is not fuzzy matching: the alias phrase either appears as a
 * contiguous run of tokens or it does not. These guards hold that line — a
 * single word inside a longer description must never identify an operation.
 */
import { describe, it, expect } from "vitest";
import { OPERATION_ALIASES, canonicalOperationKey, normalizeOperationText } from "../operationAliases";

describe("alias wording survives appended note text", () => {
  it("resolves the RO 22059 urethane pair both ways", () => {
    const key = canonicalOperationKey("BetaSeal Express Urethane");
    expect(key).toBe("URETHANE_ADHESIVE");
    expect(canonicalOperationKey("Urethane Kit... BETASEAL, 3 KITS")).toBe(key);
    expect(canonicalOperationKey("S01 Urethane Kit... BETASEAL, 3 KITS")).toBe(key);
  });

  it("resolves the tint-color pair across both producers' notes", () => {
    const key = canonicalOperationKey("Tint color > Three stage let down panel");
    expect(key).toBe("TINT_COLOR");
    expect(canonicalOperationKey("Color Tint Spray Out Panel")).toBe(key);
  });

  it("exact equality still resolves, unchanged", () => {
    for (const [key, aliases] of Object.entries(OPERATION_ALIASES)) {
      for (const alias of aliases) expect(canonicalOperationKey(alias)).toBe(key);
    }
  });

  it("file metadata is never loaded as an operation", () => {
    // $comment holds an ARRAY of prose lines; an Array.isArray filter alone
    // admits it, and containment would then let ten English sentences claim a
    // description.
    expect(Object.keys(OPERATION_ALIASES).some((key) => key.startsWith("$"))).toBe(false);
    expect(canonicalOperationKey("Estimators extend this file directly")).toBeNull();
  });
});

describe("containment never over-reaches", () => {
  it("a single alias word inside a longer description identifies nothing", () => {
    // "URETHANE" alone is not an operation — "Clean up urethane" is a distinct
    // labor line from applying the adhesive, and must not pair with it.
    expect(canonicalOperationKey("Clean up urethane")).toBeNull();
    expect(canonicalOperationKey("Wax")).toBeNull();
  });

  it("unrelated prose that merely mentions a noun resolves to nothing", () => {
    expect(canonicalOperationKey("Return the kit to the parts department")).toBeNull();
    expect(canonicalOperationKey("Estimate Share - Questions")).toBeNull();
    expect(canonicalOperationKey("")).toBeNull();
  });

  it("the most specific alias wins when phrases nest", () => {
    // Longest-first ordering: a description carrying a longer alias phrase must
    // not be claimed by a shorter phrase contained inside it.
    const phrases = Object.entries(OPERATION_ALIASES).flatMap(([key, aliases]) =>
      aliases.filter((alias) => alias.split(" ").length >= 2).map((alias) => [alias, key] as const)
    );
    for (const [alias, key] of phrases) {
      const longer = phrases.find(
        ([other, otherKey]) => otherKey !== key && other.includes(alias) && other !== alias
      );
      if (longer) expect(canonicalOperationKey(longer[0])).toBe(longer[1]);
    }
  });

  it("normalization is unchanged — parentheticals and punctuation still drop", () => {
    expect(normalizeOperationText("Finish sand & polish (0.5 Refinish per panel)")).toBe(
      "FINISH SAND POLISH"
    );
  });
});
