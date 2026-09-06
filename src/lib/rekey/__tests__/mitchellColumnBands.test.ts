import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildRekeySheet } from "../rekeyLedger";
import { readMitchellColumns, type MitchellPageWord } from "../mitchellColumnBands";

/**
 * RS-3 — Number / Qty / Price read from the page's measured column bands.
 *
 * The fixture is the word geometry of the SAME real Mitchell estimate the
 * text fixture came from (VIN ending MU091115, estimate 1259209948), so the
 * two readings can be compared line for line. It carries each word's page, x,
 * y and width exactly as the extractor measured them — the whole point is
 * that nothing here is a reading of the string.
 *
 * What the bands settle: this producer emits a part number and its quantity
 * as ONE text item ("88723-06130 1"), and the reflowed text cannot prove
 * where the split falls. The item's START is in the Number band and its END
 * reaches into the Qty band, which does prove it.
 */
const WORDS: MitchellPageWord[] = (
  JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/frk2-mitchell-words.json"), "utf8")) as Array<{
    p: number;
    x: number;
    y: number;
    w: number;
    t: string;
  }>
).map((word) => ({ page: word.p, x: word.x, y: word.y, width: word.w, height: 8, text: word.t }));

const TEXT = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/frk2-mitchell-text.txt"), "utf8");
const reading = readMitchellColumns(WORDS);
const row = (line: number) => reading?.rows.get(line);

describe("column bands come from the header the page prints", () => {
  it("finds the header on every line-item page", () => {
    expect(reading?.pagesRead).toEqual([2, 3, 4, 5]);
  });

  it("spans each band from one printed label to the next", () => {
    expect(reading?.bands.map((band) => band.label)).toEqual([
      "Line #",
      "Description",
      "Operation",
      "Type",
      "Total Units",
      "CEG",
      "Type",
      "Number",
      "Qty Total Price",
      "Tax",
    ]);
    const number = reading?.bands.find((band) => band.label === "Number");
    expect(number).toMatchObject({ from: 437.4, to: 493.8 });
  });
});

describe("a welded part number and quantity split where the page splits them", () => {
  it("puts the token that reaches past the boundary in the quantity column", () => {
    // "88723-06130 1" is one text item starting at 437.4 and ending at 498.3,
    // which is past the Qty band's 493.8.
    expect(row(1)).toMatchObject({ partNumber: "88723-06130", qty: 1, price: 3.14 });
    expect(row(5)).toMatchObject({ partNumber: "52119-0X948", qty: 1, price: 508.8 });
  });

  it("reads a quantity above one without inventing digits into the number", () => {
    expect(row(21)).toMatchObject({ partNumber: "47749-02020", qty: 3, price: 19.92 });
    expect(row(27)).toMatchObject({ partNumber: "52521-06150", qty: 2, price: 21.26 });
  });

  it("keeps a short part number whole when its quantity prints as its own item", () => {
    // 8537106010 ends at 485.1, inside the Number band, and the "4" is a
    // separate item at the Qty band's own x.
    expect(row(41)).toMatchObject({ partNumber: "8537106010", qty: 4, price: 9.52 });
    expect(row(45)).toMatchObject({ partNumber: "90119A0484", qty: 2, price: 2.12 });
  });

  it("joins a part number the print wrapped after its hyphen", () => {
    expect(row(16)).toMatchObject({ partNumber: "90467-07049-23", qty: 2, price: 3.96 });
    expect(row(22)).toMatchObject({ partNumber: "90467-07049-23", qty: 4, price: 7.92 });
    expect(row(33)).toMatchObject({ partNumber: "81110-06C91", qty: 1 });
  });

  it("does not join page furniture printed in the same column", () => {
    // "System profile", "Profile Version" and "4.0" print inside the Number
    // band on every page footer. Only a number left open by a trailing hyphen
    // takes a continuation, so none of them can reach a part.
    const numbers = [...(reading?.rows.values() ?? [])].map((entry) => entry.partNumber).filter(Boolean);
    expect(numbers.some((number) => /profile|version|^4\.0$/i.test(number as string))).toBe(false);
  });

  it("reads the tax column the page prints", () => {
    expect(row(1)?.taxable).toBe(true);
  });
});

describe("the sheet takes the measured columns over the welded string", () => {
  const withBands = buildRekeySheet({ text: TEXT, sourceFile: "frk2.pdf", columns: reading });
  const withoutBands = buildRekeySheet({ text: TEXT, sourceFile: "frk2.pdf" });
  const sheetRow = (sheet: typeof withBands, line: number) => sheet.rows.find((entry) => entry.sourceLine === line);

  it("retires the welded-quantity caveat on every row the bands settled", () => {
    const before = withoutBands.rows.filter((entry) => entry.flags.includes("qty welded: verify")).length;
    const after = withBands.rows.filter((entry) => entry.flags.includes("qty welded: verify")).length;
    expect(before).toBe(19);
    expect(after).toBe(0);
  });

  it("agrees with the text reader on this document, part number for part number", () => {
    // Both readings were checked against the CCC EMS export of the estimate
    // keyed from this document: 51 part numbers, none missing, none wrong.
    for (const entry of withoutBands.rows) {
      if (entry.sourceLine === null || entry.partNumber === null) continue;
      expect(sheetRow(withBands, entry.sourceLine)?.partNumber).toBe(entry.partNumber);
    }
  });

  it("does not write a sublet charge into the part price a second time", () => {
    // The pre-repair scan prints $201.00 in the Total Price column and is
    // booked as a sublet charge, not as a part.
    const scan = sheetRow(withBands, 76);
    expect(scan?.misc?.amount).toBe(201);
    expect(scan?.price).toBeNull();
  });

  it("says on the sheet how many rows it measured", () => {
    expect(withBands.stats.columnsMeasured).toBe(46);
    expect(withoutBands.stats.columnsMeasured).toBe(0);
  });

  it("leaves the totals closing exactly as they did", () => {
    expect(withBands.derivedTotals?.check).toMatchObject({ delta: 0, closes: true });
    expect(withBands.reconciliation.failures).toEqual([]);
  });
});

describe("a document with no header this reader knows changes nothing", () => {
  it("returns null rather than guessing bands", () => {
    expect(readMitchellColumns([{ page: 1, x: 10, y: 10, width: 40, height: 8, text: "Nothing here" }])).toBeNull();
  });
});
