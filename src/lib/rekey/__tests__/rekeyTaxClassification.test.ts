import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildRekeySheet } from "../rekeyLedger";
import { normalizeEmsEstimate, readEmsBundle } from "../emsReader";
import { keyedEstimateFromEms, verifyRekey } from "../rekeyVerification";

/**
 * RS-9 / RS-10 / RS-11 — which column a line's money is in, and which tax
 * flag answers for it.
 *
 * Both platforms state tax per COLUMN, not per line: a part's tax flag, a
 * miscellaneous charge's tax flag and the labor's tax flag are three separate
 * fields, and only one of them answers "is this line's money taxed". Reading
 * the wrong one, or reading a column that is zero on every line as though it
 * carried a charge, produces findings that are not findings — and a
 * verification report an estimator stops reading.
 */
const FRK1B = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/frk1b-mitchell-text.txt"), "utf8");
const FRK2 = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/frk2-mitchell-text.txt"), "utf8");
const emsFiles = () => {
  const dir = path.join(process.cwd(), "tests/fixtures/ems-rk1a");
  return fs.readdirSync(dir).map((name) => ({ filename: name, bytes: new Uint8Array(fs.readFileSync(path.join(dir, name))) }));
};
const estimate = normalizeEmsEstimate(readEmsBundle(emsFiles()));

describe("RS-9 — the keyed side's tax flag comes from the column the money is in", () => {
  it("reads the part tax column a real export fills on every part line", () => {
    const parts = estimate.lines.filter((line) => line.price !== null && line.price !== 0);
    expect(parts.length).toBeGreaterThan(20);
    expect(parts.every((line) => line.taxable === true)).toBe(true);
  });

  it("leaves the flag unknown on a line with no money to tax", () => {
    const noMoney = estimate.lines.filter(
      (line) => (line.price ?? 0) === 0 && line.misc === null && line.labor.every((entry) => (entry.hours ?? 0) === 0)
    );
    expect(noMoney.length).toBeGreaterThan(0);
    expect(noMoney.every((line) => line.taxable === null)).toBe(true);
  });

  it("does not read a zero miscellaneous column as a miscellaneous charge", () => {
    // The export writes MISC_AMT on all 176 records, zero on every line that
    // carries no charge. Only the seven sublet lines are real.
    const withMisc = estimate.lines.filter((line) => line.misc !== null);
    expect(withMisc).toHaveLength(7);
    expect(withMisc.every((line) => line.misc?.sublet === true)).toBe(true);
  });
});

describe("RS-9 — the verification compares tax like with like", () => {
  const sheet = buildRekeySheet({ text: FRK1B, sourceFile: "frk1b.pdf" });
  const keyed = keyedEstimateFromEms(readEmsBundle(emsFiles()), "ab7f6e93.zip");
  if (!keyed.ok) throw new Error(keyed.reason);
  const verification = verifyRekey({ sheet, keyed: keyed.estimate });
  const deltasNamed = (field: string) =>
    verification.lineFindings.flatMap((finding) => finding.deltas).filter((delta) => delta.field === field);

  it("reports no tax disagreement where the two sides agree", () => {
    // Every taxed part on the sheet was being reported as "found: not
    // taxable", because its flag was read against the export's MISCELLANEOUS
    // tax column — which a part line leaves false, having no charge to tax.
    expect(deltasNamed("tax flag")).toEqual([]);
  });

  it("reports only the miscellaneous amounts that exist", () => {
    expect(deltasNamed("miscellaneous amount")).toHaveLength(3);
    expect(deltasNamed("miscellaneous amount").every((delta) => delta.found !== "$0.00")).toBe(true);
  });

  it("leaves every other finding standing", () => {
    // RV-5 later retired ten more of these the same way it retired the
    // quantity findings: an export writes 0 in every column of every line, so
    // "expected not keyed, found $0.00" against a labor line and "found 0.0 h"
    // against a part line are the same absence written twice — six prices and
    // four hour findings here.
    //
    // RV-5 also retired the five quantity findings this once counted six of:
    // a labor line has no quantity, and "not printed" against the export's
    // zero is the same absence written twice. The one that survives is a part
    // line whose price also differs, which is a real difference.
    const counts = verification.lineFindings
      .flatMap((finding) => finding.deltas)
      .reduce<Record<string, number>>((totals, delta) => ({ ...totals, [delta.field]: (totals[delta.field] ?? 0) + 1 }), {});
    expect(counts).toEqual({
      "LAB included flag": 6,
      "LAB hours": 5,
      "LAM hours": 3,
      "miscellaneous amount": 3,
      operation: 6,
      "part number": 2,
      "part type": 2,
      price: 5,
      quantity: 1,
    });
  });
});

describe("RS-11 — a taxed sublet-type line is a part, an untaxed one is labor", () => {
  const sheet = buildRekeySheet({ text: FRK2, sourceFile: "frk2.pdf" });
  const subletParts = sheet.rows.filter((row) => row.partTypeCanonical === "Sublet" && row.misc === null);
  const subletCharges = sheet.rows.filter((row) => row.misc?.sublet === true);

  it("keeps the taxed sublet lines in the parts column, where the source books them", () => {
    expect(subletParts.map((row) => row.price)).toEqual([469, 90.45, 335, 201]);
    expect(subletParts.every((row) => row.taxable === true)).toBe(true);
    // That $1,095.45 is the base the source's own parts adjustment marks up.
    const markup = sheet.profile.find((field) => field.field === "Sublet parts markup");
    expect(markup?.value).toBe(25);
    expect(markup?.note).toContain("$1095.45");
  });

  it("books the untaxed sublet charges to the labor category the row bills", () => {
    expect(subletCharges.map((row) => row.misc?.amount)).toEqual([201, 167.5, 201, 10]);
    expect(subletCharges.every((row) => row.taxable === null)).toBe(true);
    // The print's own sublet / additional columns: $569.50 mechanical, $10 body.
    const check = (category: string) =>
      sheet.reconciliation.rows.find((entry) => entry.category === category);
    expect(check("Mechanical Labor sublet / additional")).toMatchObject({ printed: 569.5, derived: 569.5, closes: true });
    expect(check("Body Labor sublet / additional")).toMatchObject({ printed: 10, derived: 10, closes: true });
  });
});

describe("RS-10 — every part type the prints use resolves to a CCC and an EMS code", () => {
  const types = (text: string) =>
    [...new Set(buildRekeySheet({ text, sourceFile: "x.pdf" }).rows.map((row) => `${row.partTypeSource}|${row.partTypeCanonical}|${row.partTypeEms}`))]
      .filter((entry) => !entry.startsWith("null|"))
      .sort();

  it("maps every type these documents print", () => {
    // "NEW|None|null" is a stated type on a line that prints no part number —
    // see the block below. Every type printed WITH a number still resolves to
    // its CCC name and its EMS code.
    expect(types(FRK2)).toEqual(["EXISTING|None|null", "NEW|None|null", "NEW|OEM|PAN", "SUBLET|Sublet|PAS"]);
    expect(types(FRK1B)).toEqual([
      "AFTERMARKET CERTIFIED|CAPA A/M|PAC",
      "AFTERMARKET NEW|A/M|PAA",
      "AFTERMARKET NEW|None|null",
      "EXISTING|None|null",
      "NEW|None|null",
      "NEW|OEM|PAN",
      "QUAL RECYCLED PART|LKQ|PAL",
      "SUBLET|Sublet|PAS",
    ]);
  });
});

/**
 * A part type you order by NUMBER, on a line that prints no number.
 *
 * The evidence is one claim written in BOTH systems. The Mitchell print bills
 * "Interior protection kit ... New 1 $3.22" with no part number; the CCC
 * estimate of that same claim bills the same $3.22 with NO part type at all,
 * and both platforms count it in their parts totals. Ten more of the shop's
 * charges match dollar for dollar across the two documents the same way.
 * Reporting them as OEM parts put a part type on lines that have no part, and
 * an OEM line with no number cannot be keyed in CCC at all.
 */
describe("a stated part type with no part number is not a part to order", () => {
  const sheet = buildRekeySheet({ text: FRK2, sourceFile: "frk2.pdf" });
  const row = (line: number) => sheet.rows.find((entry) => entry.sourceLine === line);

  it("keeps the printed word and withholds the part type it cannot support", () => {
    const kit = row(86);
    expect(kit?.descriptionSource).toMatch(/Interior protection kit/i);
    expect(kit).toMatchObject({ partTypeSource: "NEW", partTypeCanonical: "None", partTypeEms: null, partNumber: null });
    expect(kit?.flags).toContain("part number: not printed");
    expect(kit?.notes.join(" ")).toMatch(/no part number, so there is no part to order/);
  });

  it("leaves the money exactly where the source books it", () => {
    // The source counts these dollars in its printed parts total, so the row
    // keeps its price and the sheet still closes to the cent. Moving them to
    // a charge would have broken the parts row by $119.48.
    expect(row(86)?.price).toBe(3.22);
    expect(row(86)?.misc).toBeNull();
    expect(sheet.reconciliation.rows.find((entry) => entry.category === "Parts")).toMatchObject({
      printed: 7023.83,
      derived: 7023.83,
      closes: true,
    });
    expect(sheet.derivedTotals?.check).toMatchObject({ delta: 0, closes: true });
  });

  it("touches no line that prints a number to order", () => {
    // The grille is a real OEM part on the same document, printed with its
    // number; it keeps its type and its export code.
    const grille = sheet.rows.find((entry) => entry.partNumber === "53101-06650");
    expect(grille).toMatchObject({ partTypeCanonical: "OEM", partTypeEms: "PAN" });
    expect(sheet.rows.filter((entry) => entry.flags.includes("part number: not printed")).every((entry) => entry.partNumber === null)).toBe(true);
  });

  it("applies to any type ordered by number, not only OEM", () => {
    // F-RK1b bills refrigerant as an aftermarket line with no part number.
    const frk1b = buildRekeySheet({ text: FRK1B, sourceFile: "frk1b.pdf" });
    const freon = frk1b.rows.find((entry) => /FREON/i.test(entry.descriptionSource));
    expect(freon).toMatchObject({ partTypeSource: "AFTERMARKET NEW", partTypeCanonical: "None", partTypeEms: null });
    expect(frk1b.derivedTotals?.check).toMatchObject({ delta: 0, closes: true });
  });
});
