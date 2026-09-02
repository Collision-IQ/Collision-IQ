import { describe, expect, it } from "vitest";
import { buildRekeySheet, harvestRowNotes, recoverSpacedPartNumber } from "../rekeyLedger";
import { SOURCE_ESTIMATE_TEXT } from "./fixtures";

const sheet = buildRekeySheet({ text: SOURCE_ESTIMATE_TEXT, sourceFile: "source.pdf" });
const row = (line: number) => sheet.rows.find((candidate) => candidate.sourceLine === line);

describe("rekey ledger — line translation", () => {
  it("reads the supplement tag printed ahead of the line number", () => {
    expect(row(21)?.supplementTag).toBe("S2");
    expect(row(21)?.sourceLine).toBe(21);
  });

  it("translates a word-spelled operation into CCC vocabulary with its EMS op code", () => {
    expect(row(21)?.operationCcc).toBe("Repl");
    expect(row(21)?.laborOpCode).toBe("OP11");
    expect(row(21)?.operationSource).toBe("Remove / Replace");
    expect(row(30)?.operationCcc).toBe("R&I");
    expect(row(30)?.laborOpCode).toBe("OP2");
    expect(row(31)?.operationCcc).toBe("Rpr");
  });

  it("prefers the most specific part type when several tokens appear on one row", () => {
    expect(row(32)?.partTypeCcc).toBe("CAPA A/M");
    expect(row(32)?.partTypeEms).toBe("PAC");
    expect(row(21)?.partTypeCcc).toBe("OEM");
    expect(row(79)?.partTypeCcc).toBe("LKQ");
    expect(row(79)?.partTypeEms).toBe("PAL");
  });

  it("keys part numbers without the spacing the source prints", () => {
    const spaced = buildRekeySheet({
      text: SOURCE_ESTIMATE_TEXT.replace("FO1230344C", "M1PZ 17E810 AA"),
      sourceFile: "source.pdf",
    });
    const hood = spaced.rows.find((candidate) => candidate.sourceLine === 21);
    expect(hood?.partNumber).not.toMatch(/\s/);
    expect(hood?.partNumberSource).toBeTruthy();
  });

  it("maps a source section onto its CCC group and routes diagnostics work separately", () => {
    expect(row(30)?.sectionCcc).toBe("FRONT BUMPER & GRILLE");
    expect(row(80)?.sectionCcc).toBe("VEHICLE DIAGNOSTICS");
    expect(row(76)?.sectionCcc).toBe("MISCELLANEOUS OPERATIONS");
  });
});

describe("spaced part-number recovery", () => {
  it("recovers a spaced OEM number printed at the end of the description", () => {
    expect(recoverSpacedPartNumber("Hood Panel Alum New M1PZ 17E810 AA")).toEqual({
      partNumberSource: "M1PZ 17E810 AA",
      description: "Hood Panel Alum New",
    });
  });

  it("stops at an all-caps description word so a side token is never consumed", () => {
    expect(recoverSpacedPartNumber("Hood LT M1PZ 17E810")).toEqual({
      partNumberSource: "M1PZ 17E810",
      description: "Hood LT",
    });
  });

  it("does not read prose as a part number", () => {
    expect(recoverSpacedPartNumber("Bumper cover")).toBeNull();
    expect(recoverSpacedPartNumber("Remove and replace")).toBeNull();
  });
});

describe("rekey ledger — special cases", () => {
  it("folds refinish-only lines into the part line above them", () => {
    expect(row(22)).toBeUndefined();
    expect(row(23)).toBeUndefined();
    expect(sheet.stats.foldedRefinishRows).toBe(2);
    const refinish = row(21)?.labor.filter((entry) => entry.type === "LAR") ?? [];
    expect(refinish.map((entry) => entry.hours).reduce((a, b) => a + b, 0)).toBeCloseTo(7.0, 5);
  });

  it("emits ONE aggregate clear-coat row and never distributes it", () => {
    const aggregate = sheet.rows.filter((candidate) => /clear coat/i.test(candidate.descriptionCcc));
    expect(aggregate).toHaveLength(1);
    expect(aggregate[0].labor).toEqual([{ type: "LAR", hours: 3.1, included: false, judgment: false }]);
    expect(aggregate[0].sectionCcc).toBe("MISCELLANEOUS OPERATIONS");
    expect(aggregate[0].notes.join(" ")).toMatch(/do not distribute/i);
  });

  it("routes paint materials to the profile block instead of a keying row", () => {
    const materials = row(75);
    expect(materials?.keyable).toBe(false);
    expect(materials?.notes.join(" ")).toMatch(/profile/i);
  });

  it("keeps a cost-only line as a miscellaneous entry", () => {
    expect(row(76)?.misc?.amount).toBe(4);
    expect(row(76)?.keyable).toBe(true);
  });

  it("attaches a coded note to the row above it", () => {
    expect(harvestRowNotes(SOURCE_ESTIMATE_TEXT).get(23)).toEqual(["Reconcile with invoice"]);
  });

  it("drops rows read out of the estimate totals block", () => {
    expect(sheet.rows.some((candidate) => /paint supplies/i.test(candidate.descriptionCcc))).toBe(false);
  });
});

describe("rekey ledger — profile block and totals", () => {
  it("reads the labor rates the estimator must set before keying", () => {
    const field = (name: string) => sheet.profile.find((entry) => entry.field === name);
    expect(field("Body rate (LAB)")?.value).toBe(61);
    expect(field("Paint rate (LAR)")?.value).toBe(61);
  });

  it("derives the paint supplies rate when the source prints no basis, and says so", () => {
    const materials = sheet.profile.find((entry) => entry.field === "Paint supplies rate (MAPA)");
    expect(materials?.basis).toBe("derived");
    expect(materials?.value).toBeCloseTo(701.4 / 10.1, 2);
    expect(materials?.note).toMatch(/prints no rate/i);
  });

  it("instructs a zero recycled-part markup rather than inheriting the shop profile", () => {
    const markup = sheet.profile.find((entry) => entry.field === "Recycled / aftermarket markup");
    expect(markup?.value).toBe(0);
    expect(markup?.basis).toBe("instruction");
  });

  it("carries the source totals through as the expected keyed result", () => {
    expect(sheet.expectedTotals?.grandTotal).toBe(3215.62);
    expect(sheet.expectedTotals?.tax).toBe(182.02);
  });

  it("groups rows in CCC order", () => {
    expect(sheet.groups.map((group) => group.group)).toEqual([
      "FRONT BUMPER & GRILLE",
      "HOOD",
      "VEHICLE DIAGNOSTICS",
      "MISCELLANEOUS OPERATIONS",
    ]);
  });
});

describe("rekey ledger — fail closed", () => {
  it("writes no rows and says so when nothing could be read", () => {
    const empty = buildRekeySheet({ text: "This document contains no estimate lines.", sourceFile: "x.pdf" });
    expect(empty.rows).toHaveLength(0);
    expect(empty.warnings.join(" ")).toMatch(/no line items/i);
  });

  it("never invents a CCC group for a section it does not know", () => {
    const unknown = buildRekeySheet({
      text: "WIDGET ASSEMBLY\n1 Remove / Replace Widget 1 10.00 0.5\n",
      sourceFile: "x.pdf",
    });
    const widget = unknown.rows[0];
    expect(widget.sectionCcc).toBe("UNMAPPED");
    expect(widget.sectionSource).toBe("WIDGET ASSEMBLY");
    expect(widget.flags).toContain("group: verify");
  });
});
