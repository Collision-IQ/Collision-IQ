/**
 * MOTOR <-> CEG part nomenclature (WO-RK1 v3).
 *
 * The description pairs below are the real ones, read off the F-RK2 paired-VIN
 * fixture — one repair order written twice, once in CCC (MOTOR) and once in
 * Mitchell (CEG), with the same scope and the labor untouched. They are the
 * evidence the table is built from, so they are what it is tested against;
 * only the wording travels here, no VIN, claim, RO or price.
 *
 * Two invariants the table must not break:
 *
 * 1. It may only turn an UNMATCHED line into a pair. It runs after the exact
 *    part-number and description passes, so it can never take a line away from
 *    a key that already placed it, and it must never fabricate a pair between
 *    two lines that are genuinely different.
 * 2. It may not move a dollar. Pairing two lines changes how they are
 *    REPORTED, never what they are worth; the totals reconciliation reads the
 *    estimates' own totals and must come out identical either way.
 */

import { describe, expect, it } from "vitest";
import {
  NOMENCLATURE_MATCH_THRESHOLD,
  canonicalizeNomenclature,
  nomenclatureOverlap,
  stripPrintArtifacts,
} from "../rekeyVocabulary";
import { buildRekeySheet } from "../rekeyLedger";
import { keyedEstimateFromDocument, verifyRekey } from "../rekeyVerification";
import { KEYED_ESTIMATE_TEXT, SOURCE_ESTIMATE_TEXT } from "./fixtures";

/** [CEG wording, MOTOR wording, CCC group] — every pair from F-RK2. */
const KNOWN_PAIRS: ReadonlyArray<[string, string, string]> = [
  ["L Frt Bumper Cover Support", "LT Side support", "FRONT BUMPER & GRILLE"],
  ["Frt Bumper Clip", "LT Absorber clip US built", "FRONT BUMPER & GRILLE"],
  ["L Front Combination Lamp", "LT R&I headlamp assy", "FRONT LAMPS"],
  ["R Upr Frt Body Support", "RT Upper arm", "RADIATOR SUPPORT"],
  ["L Upr Frt Body Support", "LT Upper arm", "RADIATOR SUPPORT"],
  ["R Frt Body Bracket", "RT Diagonal brace", "RADIATOR SUPPORT"],
  ["L Frt Body Bracket", "LT Diagonal brace", "RADIATOR SUPPORT"],
  ["Collision Access", "Collision Access - Hood will not open wh", "HOOD"],
  ["R Fender Seal", "RT Protector", "FENDER"],
  ["L Fender Seal", "LT Protector", "FENDER"],
  ["Revv ADAS", "REVVAdas Report", "VEHICLE DIAGNOSTICS"],
  ["Mask jambs", "Mask jambs (0.3 Hours and $3.00 per pane", "MISCELLANEOUS OPERATIONS"],
  ["Sand & polish", "Finish sand & polish (0.5 Refinish per p", "MISCELLANEOUS OPERATIONS"],
];

function score(a: string, b: string, group: string): number {
  return nomenclatureOverlap(
    canonicalizeNomenclature(a, group, group),
    canonicalizeNomenclature(b, group, group)
  );
}

describe("print artifacts", () => {
  it("cuts a trailing free-text note the print appended after ' - '", () => {
    expect(stripPrintArtifacts("Collision Access - Hood will not open wh")).toBe("Collision Access");
  });

  it("cuts a parenthetical the print truncated at the column width", () => {
    expect(stripPrintArtifacts("Mask jambs (0.3 Hours and $3.00 per pane")).toBe("Mask jambs");
  });

  it("leaves a description carrying neither artifact alone", () => {
    expect(stripPrintArtifacts("L Frt Bumper Cover Support")).toBe("L Frt Bumper Cover Support");
  });
});

describe("nomenclature canonicalization", () => {
  it("pairs every naming difference the paired-VIN fixture exposed", () => {
    const failures = KNOWN_PAIRS.filter(([ceg, motor, group]) => score(ceg, motor, group) < NOMENCLATURE_MATCH_THRESHOLD);
    expect(failures.map(([ceg, motor]) => `${ceg} != ${motor}`)).toEqual([]);
  });

  it("rewrites both databases' wording onto one canonical name", () => {
    expect(canonicalizeNomenclature("L Frt Bumper Cover Support", "FRONT BUMPER & GRILLE")).toEqual(["SIDE", "SUPPORT"]);
    expect(canonicalizeNomenclature("LT Side support", "FRONT BUMPER & GRILLE")).toEqual(["SIDE", "SUPPORT"]);
  });

  it("honours the scope so a generic name cannot rewrite an unrelated section", () => {
    // "Fender Seal" -> "Protector" is FENDER vocabulary. The same words under
    // a door section must be left exactly as they were printed.
    expect(canonicalizeNomenclature("R Fender Seal", "FENDER")).toEqual(["PROTECTOR"]);
    expect(canonicalizeNomenclature("R Fender Seal", "DOOR")).toEqual(["FENDER", "SEAL"]);
  });

  it("accepts an UNMAPPED group, which is a section CCC cannot name rather than a wrong one", () => {
    expect(canonicalizeNomenclature("R Upr Frt Body Support", "UNMAPPED")).toEqual(["UPPER", "ARM"]);
  });

  it("does not pair two lines that merely share a word", () => {
    expect(score("R Fender Seal", "R Fender Liner", "FENDER")).toBeLessThan(NOMENCLATURE_MATCH_THRESHOLD);
    expect(score("Upper Tie Bar", "Upr Frt Body Seal", "RADIATOR SUPPORT")).toBeLessThan(NOMENCLATURE_MATCH_THRESHOLD);
  });

  it("scores nothing for a description with no name left in it", () => {
    expect(nomenclatureOverlap([], ["SIDE", "SUPPORT"])).toBe(0);
  });
});

describe("verification — a line renamed by the other database", () => {
  const baselineSheet = buildRekeySheet({ text: SOURCE_ESTIMATE_TEXT, sourceFile: "source.pdf" });

  function verify(sourceText: string, keyedText: string) {
    const sheet = buildRekeySheet({ text: sourceText, sourceFile: "source.pdf" });
    const keyed = keyedEstimateFromDocument({ text: keyedText, sourceFile: "keyed.pdf" });
    if (!keyed.ok) throw new Error(keyed.reason);
    return verifyRekey({ sheet, keyed: keyed.estimate });
  }

  const baseline = verify(SOURCE_ESTIMATE_TEXT, KEYED_ESTIMATE_TEXT);

  /** The same physical line, printed by each database under its own name for
   *  it — the CEG "Frt Bumper Cover Support" that MOTOR calls "Side support".
   *  Nothing else about the line changes, so its money and hours are the same
   *  on both sides and the totals cannot move. */
  const renamed = verify(
    SOURCE_ESTIMATE_TEXT.replace("Repair Bumper Reinforcement Existing", "Repair Frt Bumper Cover Support Existing"),
    KEYED_ESTIMATE_TEXT.replace("Rpr Bumper Reinforcement", "Rpr Side support")
  );

  it("pairs the renamed line instead of reporting it missing and extra at once", () => {
    const finding = renamed.lineFindings.find((line) => line.description === "Frt Bumper Cover Support");
    expect(finding?.matchedBy).toBe("nomenclature");
    expect(finding?.resolution).toBe("exact");
    expect(renamed.extraLines.map((line) => line.description)).toEqual([]);
  });

  it("reports the same totals it reported before the rename — a pair cannot move a dollar", () => {
    expect(renamed.totals).toEqual(baseline.totals);
    expect(renamed.summary.pass).toBe(baseline.summary.pass);
  });

  it("refuses to pair a name the table has never been shown", () => {
    // "Bumper Cover Support" is not the CEG name for "Bumper Reinforcement",
    // and no fixture has ever said it was. A near miss must stay unpaired
    // rather than become an invented pair.
    const invented = verify(
      SOURCE_ESTIMATE_TEXT,
      KEYED_ESTIMATE_TEXT.replace("Rpr Bumper Reinforcement", "Rpr Bumper Cover Support")
    );
    const finding = invented.lineFindings.find((line) => line.description === "Bumper Reinforcement");
    expect(finding?.resolution).toBe("missing_in_keyed");
    expect(invented.extraLines.map((line) => line.description)).toEqual(["Bumper Cover Support"]);
  });

  it("still reports a line that was genuinely never keyed", () => {
    const missing = verify(SOURCE_ESTIMATE_TEXT, KEYED_ESTIMATE_TEXT.replace("3 Rpr Bumper Reinforcement 1.2\n", ""));
    expect(
      missing.lineFindings.filter((line) => line.resolution === "missing_in_keyed").map((line) => line.description)
    ).toEqual(["Bumper Reinforcement"]);
  });

  it("leaves an already-exact estimate exactly as it was", () => {
    expect(baselineSheet.rows.length).toBeGreaterThan(0);
    expect(baseline.lineFindings.every((line) => line.resolution === "exact")).toBe(true);
    expect(baseline.lineFindings.some((line) => line.matchedBy === "nomenclature")).toBe(false);
    expect(baseline.summary.pass).toBe(true);
  });
});
