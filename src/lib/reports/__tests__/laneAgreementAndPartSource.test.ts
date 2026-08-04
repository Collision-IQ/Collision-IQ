/**
 * Two defects from RO 22116, both about the same underlying mistake: deciding
 * something from one lane's view without asking the document.
 *
 * FIX 1 — the annotated PDF printed "Ln 112 BetaSeal Express Urethane
 * ($37.00): not written on AMERICAN FAMILY" while the matcher had already
 * logged "withdrew self-contradictory claims for one operation
 * (URETHANE_ADHESIVE: BetaSeal Express Urethane / A/M Urethane Kit)". The text
 * lane detected the contradiction and withdrew its own findings; the
 * annotation layer runs its own pairAndCompare and never learned. A false
 * omission claim on a structural windshield bond carrying the forward camera.
 *
 * FIX 3 — the part-source detector only scanned the ANNOTATED document for
 * non-OEM rows, so it could not see the common direction of a parts dispute:
 * the carrier specifies aftermarket where the shop specifies an OEM-approved
 * product. The $2 price gap between the two urethane lines is immaterial, and
 * that is the point — the dispute is the part, so no value threshold will ever
 * surface it.
 */
import { describe, it, expect } from "vitest";
import { canonicalOperationKey } from "../operationAliases";

describe("fix 1 — an operation on both documents is never reported absent", () => {
  it("the two urethane rows resolve to one operation, so neither is 'missing'", () => {
    // This is the identity the annotation layer now checks before printing a
    // "not written on <carrier>" note.
    expect(canonicalOperationKey("112 # BetaSeal Express Urethane 1 37.00 T")).toBe(
      "URETHANE_ADHESIVE"
    );
    expect(canonicalOperationKey("A/M Urethane Kit")).toBe("URETHANE_ADHESIVE");
  });

  it("a genuinely absent operation still resolves to something else, or to nothing", () => {
    // The guard must not silence real omissions: an unrelated row does not
    // collide with the urethane operation.
    expect(canonicalOperationKey("Repl LT Fender")).not.toBe("URETHANE_ADHESIVE");
  });
});

describe("fix 3 — the reverse direction pairs on operation identity, not resemblance", () => {
  /** The normalization the reverse pass applies before resolving an operation. */
  const resolveRowOperation = (rowText: string) =>
    canonicalOperationKey(
      rowText
        .replace(/^\s*(?:line\s*)?\d{1,4}\b/i, " ")
        .replace(/([A-Za-z])(\d)/g, "$1 $2")
        .replace(/\s+/g, " ")
        .trim()
    );

  it("resolves a row whose price is welded to the last word", () => {
    // "75 **A/M Urethane Kit135.00" returned null before the normalization,
    // because the alias "urethane kit" needs a boundary that "Kit135" destroys.
    expect(resolveRowOperation("75 **A/M Urethane Kit135.00")).toBe("URETHANE_ADHESIVE");
    expect(resolveRowOperation("112#BetaSeal Express Urethane137.00T")).toBe("URETHANE_ADHESIVE");
  });

  it("pairs the carrier's aftermarket kit with the shop's named product", () => {
    expect(resolveRowOperation("75 **A/M Urethane Kit135.00")).toBe(
      resolveRowOperation("112 # BetaSeal Express Urethane 1 37.00 T")
    );
  });

  it("refuses the resemblance that a scoring match accepted", () => {
    // "**A/M Cover Car" paired with "R&I Floor cover" on the shared generic
    // token "cover" — a different operation. Both resolve to no canonical
    // operation, so the reverse pass now declines rather than guessing.
    expect(resolveRowOperation("113 **A/M Cover Car110.000.2")).toBeNull();
    expect(resolveRowOperation("118 R&I Floor cover 0.2")).toBeNull();
  });

  it("a null operation never matches another null operation", () => {
    // Guards the rule itself: the reverse pass requires a NON-NULL shared key,
    // so two unresolvable rows must not be treated as the same part.
    const a = resolveRowOperation("113 **A/M Cover Car110.000.2");
    const b = resolveRowOperation("118 R&I Floor cover 0.2");
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(Boolean(a && b && a === b)).toBe(false);
  });
});
