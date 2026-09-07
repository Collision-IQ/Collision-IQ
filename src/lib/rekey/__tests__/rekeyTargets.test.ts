import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildRekeySheet } from "../rekeyLedger";
import { targetGaps, targetLabel, translateOperation, translatePartType } from "../rekeyTargets";

/**
 * WHICH system the sheet keys into.
 *
 * Every sheet keys into CCC today. This is the first half of giving it a
 * choice: the CCC term stays the canonical value a row carries, and the target
 * term is the word an estimator keying into that platform types.
 *
 * The acceptance check writes itself. A Mitchell estimate keyed back into
 * Mitchell should come out saying what its own print says — so the target
 * vocabulary is measured against the document it came from, not against a
 * table someone typed.
 */
const MITCHELL = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/frk2-mitchell-text.txt"), "utf8");
const sheetFor = (target?: "ccc" | "mitchell") =>
  buildRekeySheet({ text: MITCHELL, sourceFile: "Mitchell Estimate.pdf", ...(target ? { target } : {}) });

describe("a term is translated only where a document showed the word", () => {
  it("returns the platform's own word for every operation these prints state", () => {
    const words = ["Repl", "R&I", "Rpr", "Refn", "Blnd", "O/H", "Aim", "Algn", "Subl", "Manual"].map((term) => [
      term,
      translateOperation(term, "mitchell"),
    ]);
    expect(Object.fromEntries(words)).toEqual({
      Repl: "Remove Replace",
      "R&I": "Remove Install",
      Rpr: "Repair",
      Refn: "Refinish Only",
      Blnd: "Blend",
      "O/H": "Overhaul",
      Aim: "Check Adjust",
      Algn: "Align",
      Subl: "Sublet",
      Manual: "Additional Operation",
    });
  });

  it("splits the one operation that is two words on the other platform", () => {
    expect(translateOperation("Manual", "mitchell", { carriesCharge: true })).toBe("Additional Cost");
    expect(translateOperation("Manual", "mitchell", { carriesCharge: false })).toBe("Additional Operation");
    // The split is the other platform's, not CCC's.
    expect(translateOperation("Manual", "ccc", { carriesCharge: true })).toBe("Manual");
  });

  it("leaves the CCC target exactly as it was", () => {
    for (const term of ["Repl", "R&I", "Manual", "O/H"]) expect(translateOperation(term, "ccc")).toBe(term);
    for (const term of ["OEM", "LKQ", "None"]) expect(translatePartType(term, "ccc")).toBe(term);
  });

  it("says nothing where no document has shown the word", () => {
    // These two part types print on neither Mitchell estimate here.
    expect(translatePartType("CAPA A/M", "mitchell")).toBeNull();
    expect(translatePartType("Recond", "mitchell")).toBeNull();
    expect(translateOperation("Something nobody prints", "mitchell")).toBeNull();
    expect(translateOperation(null, "mitchell")).toBeNull();
  });

  it("names what a target cannot yet say", () => {
    expect(targetGaps("ccc")).toEqual([]);
    const gaps = targetGaps("mitchell").join(" ");
    // The section taxonomy is the gate, and it is stated as one.
    expect(gaps).toMatch(/Groups are still CCC's/);
    expect(gaps).toMatch(/cannot be turned back into a Mitchell section/);
    expect(gaps).toMatch(/CAPA A\/M, Recond/);
    expect(targetLabel("mitchell")).toBe("Mitchell");
  });
});

describe("the sheet keyed back into the platform it came from", () => {
  const mitchell = sheetFor("mitchell");

  it("reproduces the operation word its own print states, on every row", () => {
    // 84 of 84. Not a table checked against itself: the left side is the word
    // read off the printed page, the right side the word this build would tell
    // an estimator to type.
    const rows = mitchell.rows.filter((row) => row.operationSource);
    expect(rows).toHaveLength(84);
    const differing = rows.filter(
      (row) => (row.operationSource ?? "").toLowerCase() !== (row.operationTarget ?? "").toLowerCase()
    );
    expect(differing).toEqual([]);
  });

  it("reproduces the part-type word on every row that states one", () => {
    const stated = mitchell.rows.filter((row) => row.partTypeSource && row.partTypeTarget);
    expect(stated).toHaveLength(59);
    const differing = stated.filter(
      (row) => (row.partTypeSource ?? "").toLowerCase() !== (row.partTypeTarget ?? "").toLowerCase()
    );
    expect(differing).toEqual([]);
  });

  it("still states nothing where the part type was withheld", () => {
    // The 15 lines that print a part type with no part number. The other
    // platform's word for "None" is "Existing", which claims a part already on
    // the vehicle — the opposite of a manual charge line naming no part at all.
    const withheld = mitchell.rows.filter((row) => row.flags.includes("part number: not printed"));
    expect(withheld).toHaveLength(15);
    expect(withheld.every((row) => row.partTypeTarget === null)).toBe(true);
    expect(withheld.every((row) => row.partTypeCcc === "None")).toBe(true);
  });

  it("puts the profile-routed cost under the word that platform uses for it", () => {
    // Its print files the $912.00 materials line under Additional Costs and the
    // sublet scans under Additional Operations, though both carry a charge and
    // no hours. The discriminator is the profile-routed cost, not the charge.
    const operationAt = (line: number) => mitchell.rows.find((row) => row.sourceLine === line)?.operationTarget;
    expect(operationAt(74)).toBe("Additional Cost");
    for (const line of [75, 76, 78, 83, 87]) expect(operationAt(line)).toBe("Additional Operation");
  });

  it("warns about what it cannot translate, and closes anyway", () => {
    expect(mitchell.warnings).toHaveLength(2);
    expect(mitchell.derivedTotals?.check).toMatchObject({ printedGrandTotal: 12496.54, delta: 0, closes: true });
  });
});

describe("the target this build has always produced is untouched", () => {
  const byDefault = sheetFor();
  const explicit = sheetFor("ccc");

  it("defaults to CCC and warns about nothing", () => {
    expect(byDefault.target).toBe("ccc");
    expect(byDefault.warnings).toEqual([]);
    expect(explicit.rows).toHaveLength(byDefault.rows.length);
  });

  it("carries the CCC term in both the canonical and the target field", () => {
    for (const row of byDefault.rows) {
      expect(row.operationTarget).toBe(row.operationCcc);
      // The only rows without a target part type are the ones with no part
      // type at all to state.
      if (row.partTypeTarget !== null) expect(row.partTypeTarget).toBe(row.partTypeCcc);
    }
  });

  it("changes nothing a caller could see on the canonical fields", () => {
    const mitchell = sheetFor("mitchell");
    const canonical = (sheet: typeof byDefault) =>
      sheet.rows.map((row) => `${row.sourceLine}|${row.operationCcc}|${row.partTypeCcc}|${row.sectionCcc}|${row.price}`);
    // Choosing a target must not move a value, only add a word for it.
    expect(canonical(mitchell)).toEqual(canonical(byDefault));
  });
});
