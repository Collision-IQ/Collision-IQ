import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { assessRekeySheet, buildRekeySheet } from "../rekeyLedger";
import { readCccColumns, readEstimateColumns, readMitchellColumns, type MitchellPageWord } from "../mitchellColumnBands";

/**
 * The CCC print, read from its own column bands.
 *
 * The build has to key from EITHER platform's estimate, and the CCC lane was
 * as broken as the Mitchell lane had been — for the same reason and worse.
 * Its reflowed text gives no separator between a part number, its quantity
 * and its price, so "521190X948" + "1" + "461.44" arrives as
 * "521190X9481461.44" and the price reads as $1,461.44: a thousand dollars
 * over on every part line whose quantity is one. On this real estimate that
 * put parts at $15,346.23 against a printed $5,314.38, refinish at 9.6 h
 * against 17.3, and the gross at $22,485.42 against $12,138.16 — and the
 * gate refused the sheet rather than let it be keyed.
 *
 * The geometry has none of that trouble: every cell is its own text item.
 * The fixtures are the word geometry and the extracted text of the same real
 * estimate, so the two readings can be compared line for line.
 */
const WORDS: MitchellPageWord[] = (
  JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/ccc-1259209948-words.json"), "utf8")) as Array<{
    p: number;
    x: number;
    y: number;
    w: number;
    t: string;
  }>
).map((word) => ({ page: word.p, x: word.x, y: word.y, width: word.w, height: 8, text: word.t }));
const TEXT = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/ccc-1259209948-text.txt"), "utf8");
const columns = readEstimateColumns(WORDS);
const band = (line: number) => columns?.rows.get(line);

describe("one reader, either print", () => {
  it("recognizes the CCC header and says which layout it read", () => {
    expect(columns?.layout).toBe("ccc");
    expect(columns?.bands.map((entry) => entry.label)).toEqual([
      "Line",
      "Oper",
      "Description",
      "Part Number",
      "Qty",
      "Extended",
      "Labor",
      "Paint",
    ]);
  });

  it("does not mistake this print for the other one", () => {
    expect(readMitchellColumns(WORDS)).toBeNull();
    expect(readCccColumns(WORDS)).not.toBeNull();
  });

  it("carries the header across pages it prints only once", () => {
    // This print heads its columns on the first line-item page and runs the
    // rest under it with no header of their own. Reading each page on its own
    // found page 2 and dropped three quarters of the estimate.
    expect(columns?.pagesRead).toEqual([2, 3, 4, 5, 6, 7]);
    expect(band(110)).toBeDefined();
  });
});

describe("the columns the reflowed text welds together", () => {
  it("reads a price that the text runs together with its quantity", () => {
    expect(band(10)).toMatchObject({ partNumber: "521190X948", qty: 1, price: 461.44 });
    expect(TEXT).toContain("521190X9481461.44");
  });

  it("reads the labor and refinish columns separately", () => {
    expect(band(10)?.labor).toMatchObject({ hours: 0, included: true });
    expect(band(10)?.paint).toMatchObject({ hours: 3, included: false });
    // A clear-coat allowance bills refinish and nothing else.
    expect(band(11)).toMatchObject({ paint: { hours: 1.2, included: false }, labor: null });
  });

  it("reads the letter that names a line's labor type", () => {
    expect(band(12)?.laborMarker).toBe("m");
    expect(band(44)?.laborMarker).toBe("s");
  });
});

describe("the print's own mark decides part from charge", () => {
  it("splits the two totals to the cent", () => {
    // T = taxed miscellaneous, X = non taxed miscellaneous, from the
    // abbreviation legend the estimate prints on its own last page.
    const priced = [...(columns?.rows.values() ?? [])].filter((row) => row.price !== null);
    const sum = (marked: boolean) =>
      Math.round(priced.filter((row) => (row.miscMarker !== null) === marked).reduce((total, row) => total + (row.price ?? 0), 0) * 100) / 100;
    expect(sum(false)).toBe(5314.38);
    expect(sum(true)).toBe(1791.21);
  });
});

describe("the sheet the CCC estimate produces", () => {
  const sheet = buildRekeySheet({ text: TEXT, sourceFile: "ccc.pdf", columns });

  it("reproduces every printed total from its own rows", () => {
    const row = (category: string) => sheet.reconciliation.rows.find((entry) => entry.category === category);
    expect(row("Parts")).toMatchObject({ printed: 5314.38, derived: 5314.38, closes: true });
    expect(row("Body Labor hours")).toMatchObject({ printed: 26.8, derived: 26.8, closes: true });
    expect(row("Paint Labor hours")).toMatchObject({ printed: 17.3, derived: 17.3, closes: true });
    expect(row("Miscellaneous")).toMatchObject({ printed: 1791.21, derived: 1791.21, closes: true });
    expect(sheet.reconciliation.failures).toEqual([]);
  });

  it("reaches the printed gross from its rows and profile", () => {
    expect(sheet.derivedTotals?.check).toMatchObject({ printedGrandTotal: 12138.16, delta: 0, closes: true });
  });

  it("passes the gate that refused it", () => {
    expect(assessRekeySheet(sheet)).toEqual({ ok: true, reason: null });
  });

  it("bills a marked line where the print bills it, and keeps the mark", () => {
    // The print marks seven lines mechanical and two structural, then totals
    // all nine under Body Labor because it carries no category for them:
    // 23.9 body + 1.9 mechanical + 1.0 structural is the 26.8 it prints.
    const marked = sheet.rows.filter((entry) => entry.flags.some((flag) => flag.startsWith("marked ")));
    expect(marked.length).toBe(9);
    expect(marked.every((entry) => entry.labor.every((labor) => labor.type === "LAB"))).toBe(true);
    const marks = marked.map((entry) => entry.flags.find((flag) => flag.startsWith("marked ")));
    expect(marks.filter((mark) => mark === "marked LAM")).toHaveLength(7);
    expect(marks.filter((mark) => mark === "marked LAS")).toHaveLength(2);
  });

  it("keeps a part line whose number the text welded into the description", () => {
    // Read from the text alone this line's $2.12 extended price and quantity
    // 2 ran together into a $422.12 charge with no part at all. The sheet
    // keys the UNIT price, and the CCC export of this estimate carries the
    // same $1.06 in ACT_PRICE.
    const bolt = sheet.rows.find((entry) => entry.sourceLine === 62);
    expect(bolt).toMatchObject({ partNumber: "90119A0484", qty: 2, price: 1.06, misc: null });
  });
});

describe("a blank operation column is reported as blank", () => {
  const sheet = buildRekeySheet({ text: TEXT, sourceFile: "ccc.pdf", columns });
  const line5 = sheet.rows.find((entry) => entry.sourceLine === 5);

  it("does not tell the estimator to read wording that is not there", () => {
    // Line 5 prints "Rpl information labels" with an EMPTY Oper column. Saying
    // it "carries an operation this build does not translate" sends him
    // looking for a word the print never wrote.
    expect(line5?.operationSource).toBeNull();
    expect(line5?.flags).toContain("operation: not printed");
    expect(line5?.flags).not.toContain("operation: verify");
  });

  it("counts the two causes separately, because they call for different work", () => {
    // Six: this line, and the five "Add for ..." allowances whose operation
    // column is equally empty.
    expect(sheet.stats).toMatchObject({ unmappedOperations: 6, untranslatedOperations: 0, unstatedOperations: 6 });
    expect(sheet.warnings).toContain(
      "6 lines have no operation printed against them. Choose the operation from the line's own wording when keying."
    );
    expect(sheet.warnings.some((warning) => /does not translate/.test(warning))).toBe(false);
  });

  it("does not take a word off the front of a description and call it an operation", () => {
    // "Add" was an alias of the manual-entry operation, so a CCC print's
    // "Add for Clear Coat" — a refinish allowance in an EMPTY operation
    // column — was read as operation "Add" against description "for Clear
    // Coat". CCC has no "Add" operation, and the description lost its
    // subject. Both halves are back where the print put them.
    const adds = sheet.rows.filter((entry) => [11, 12, 54, 55, 56].includes(entry.sourceLine ?? -1));
    expect(adds.map((entry) => entry.descriptionTarget)).toEqual([
      "Add for Clear Coat",
      "Add for park sensor",
      "Add for Clear Coat",
      "Add for Underside(Complete)",
      "Add for Clear Coat",
    ]);
    expect(adds.every((entry) => entry.operationSource === null && !entry.operationMapped)).toBe(true);
  });

  it("leaves a head word that IS an operation exactly where it was", () => {
    // Both of these print with an empty operation column too, but O/H and Aim
    // are real CCC operations, so reading them off the description head is
    // right and the sheet keeps doing it.
    expect(sheet.rows.find((entry) => entry.sourceLine === 9)).toMatchObject({
      operationCanonical: "O/H",
      descriptionTarget: "front bumper",
    });
    expect(sheet.rows.find((entry) => entry.sourceLine === 38)).toMatchObject({
      operationCanonical: "Aim",
      descriptionTarget: "headlamps",
    });
  });

  it("leaves a print that states every operation saying nothing at all", () => {
    const mitchell = buildRekeySheet({
      text: fs.readFileSync(path.join(process.cwd(), "tests/fixtures/frk1b-mitchell-text.txt"), "utf8"),
      sourceFile: "frk1b.pdf",
    });
    expect(mitchell.stats).toMatchObject({ untranslatedOperations: 0, unstatedOperations: 0 });
    expect(mitchell.warnings.some((warning) => /operation/.test(warning))).toBe(false);
  });
});

describe("the description is read from its column, markers and all", () => {
  const sheet = buildRekeySheet({ text: TEXT, sourceFile: "ccc.pdf", columns });
  const row = (line: number) => sheet.rows.find((entry) => entry.sourceLine === line);

  it("does not take a line's own marker as the end of its description", () => {
    // The structural marker "s" prints to the right of the description and
    // runs together with it in the reflowed text: "RT Upper arm" + "s".
    expect(TEXT).toContain("AlgnRT Upper arms0.5");
    expect(row(44)).toMatchObject({ descriptionSource: "RT Upper arm", operationCanonical: "Algn" });
    expect(row(44)?.flags).toContain("marked LAS");
  });

  it("keeps a description the reflowed text cut to its first word", () => {
    expect(row(77)).toMatchObject({ descriptionSource: "High note horn w/o F Sport" });
    expect(row(78)).toMatchObject({ descriptionSource: "Low note horn w/o F Sport" });
  });

  it("joins a description that wrapped onto the next line", () => {
    expect(row(10)?.descriptionSource).toBe("Bumper cover w/park alert US built");
  });

  it("stops at anything that is not the rest of the description", () => {
    // A note, a note's own second line, the next page's heading, and the
    // ESTIMATE TOTALS block all print under a row with no line number of
    // their own. Joining any of them swallowed whole blocks into a row.
    expect(row(27)?.descriptionSource).toBe("Emblem");
    expect(row(33)?.descriptionSource).toBe("Raw plastic primer (Per raw plastic panel)");
    expect(row(110)).toMatchObject({ descriptionSource: "RTA Agreement", keyable: true });
    expect(sheet.reconciliation.failures).toEqual([]);
  });

  it("knows the part number before it resolves the part type from it", () => {
    // Reading the description off the columns takes the spaced part number
    // out of it, which is right — and left six OEM parts with no part type
    // until the measured number was known first.
    expect(row(4)).toMatchObject({ partNumber: "112980P800", partTypeCanonical: "OEM", partTypeEms: "PAN" });
    expect(row(37)).toMatchObject({ partNumber: "8111006C91", partTypeCanonical: "OEM", partTypeEms: "PAN" });
    expect(sheet.rows.filter((entry) => entry.partNumber && entry.partTypeCanonical === "None")).toEqual([]);
  });
});

describe("without the geometry the sheet is still refused, not keyed", () => {
  it("fails the gate on the text alone", () => {
    const textOnly = buildRekeySheet({ text: TEXT, sourceFile: "ccc.pdf" });
    expect(assessRekeySheet(textOnly).ok).toBe(false);
    expect(assessRekeySheet(textOnly).reason).toMatch(/do not reproduce the totals/);
  });
});
