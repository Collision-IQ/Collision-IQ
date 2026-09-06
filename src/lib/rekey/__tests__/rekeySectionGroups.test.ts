import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildRekeySheet } from "../rekeyLedger";
import { resolveSectionGroup } from "../rekeyVocabulary";

/**
 * Section-to-group mapping, checked against the CCC estimate the same Mitchell
 * estimate was actually keyed into.
 *
 * The evidence is a paired export: one loss (2021 Lexus ES 350, VIN ending
 * MU091115) with the Mitchell print the sheet is built from and the CCC print
 * produced by keying it. The CCC side heads each line band with the group the
 * estimator's lines landed in, so the correct group for a Mitchell section is
 * not inferred here — it is read off the destination document.
 *
 * Two mappings came out of that pair:
 *
 * 1. "Information Labels" was UNMAPPED because INFORMATION LABELS was missing
 *    from the known CCC group list. CCC prints it verbatim as a group heading,
 *    so the mapping is identity, not a guess.
 * 2. "Front Inner Structure" mapped to FRAME, but all eight of its lines —
 *    upper tie bar, upper front body supports, front body brackets, the seal,
 *    the frame-bench setup and the cavity wax — were keyed under RADIATOR
 *    SUPPORT. FRAME stays reachable for the rail and apron wording that
 *    section also carries on other vehicles.
 */
const TEXT = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/frk2-mitchell-text.txt"), "utf8");
const sheet = buildRekeySheet({ text: TEXT, sourceFile: "frk2.pdf" });

const mapping = () => {
  const seen = new Map<string, string>();
  for (const row of sheet.rows) {
    if (row.sectionSource === null) continue;
    const key = `${row.sectionSource} -> ${row.sectionCcc}`;
    seen.set(key, key);
  }
  return [...seen.keys()].sort();
};

describe("section groups match the CCC estimate the Mitchell was keyed into", () => {
  it("maps every section the estimate prints", () => {
    expect(sheet.stats.unmappedSections).toBe(0);
    expect(sheet.warnings.filter((warning) => /no known CCC group/i.test(warning))).toEqual([]);
  });

  it("puts each section in the group CCC printed it under", () => {
    expect(mapping()).toEqual([
      "Additional Costs Materials -> MISCELLANEOUS OPERATIONS",
      "Additional Operations -> MISCELLANEOUS OPERATIONS",
      "Additional Operations -> VEHICLE DIAGNOSTICS",
      "Air Cleaner -> ENGINE / TRANSAXLE",
      "Electrical -> ELECTRICAL",
      "Front Bumper -> FRONT BUMPER & GRILLE",
      "Front Fender -> FENDER",
      "Front Inner Structure -> RADIATOR SUPPORT",
      "Front Lamps -> FRONT LAMPS",
      "Grille -> FRONT BUMPER & GRILLE",
      "Hood -> HOOD",
      "Information Labels -> INFORMATION LABELS",
      "Rear Bumper -> REAR BUMPER",
    ]);
  });

  it("carries the three label lines with their part numbers", () => {
    const labels = sheet.rows.filter((row) => row.sectionCcc === "INFORMATION LABELS");
    expect(labels.map((row) => row.partNumber)).toEqual(["88723-06130", "11298-0P800", "15369-0P010"]);
    expect(labels.every((row) => !row.flags.includes("group: verify"))).toBe(true);
  });

  it("keeps FRAME reachable for rail and apron wording in the same section", () => {
    expect(resolveSectionGroup({ section: "Front Inner Structure", description: "Frt Body Upper Tie Bar" }).group).toBe(
      "RADIATOR SUPPORT"
    );
    expect(resolveSectionGroup({ section: "Front Inner Structure", description: "R Frt Frame Rail" }).group).toBe("FRAME");
    expect(resolveSectionGroup({ section: "Front Inner Structure", description: "L Frt Apron Assy" }).group).toBe("FRAME");
    // A frame-bench setup line is not a rail line; CCC left it in the group
    // whose panel it serves.
    expect(resolveSectionGroup({ section: "Front Inner Structure", description: "Set up vehicle on frame bench" }).group).toBe(
      "RADIATOR SUPPORT"
    );
  });
});
