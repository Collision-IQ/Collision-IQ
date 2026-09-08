import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildRekeySheet } from "../rekeyLedger";
import { normalizeEmsEstimate, parseDbaseTable, readEmsBundle } from "../emsReader";
import { buildEmsExport, isRekeyEmsWriterEnabled, formatDbaseValue, writeDbaseTable } from "../emsWriter";
import { keyedEstimateFromEms, verifyRekey } from "../rekeyVerification";
import { readEstimateColumns, type MitchellPageWord } from "../mitchellColumnBands";

/**
 * The EMS writer's acceptance test is a ROUND TRIP.
 *
 * An export nobody can read is worse than no export: it fails inside the
 * receiving system, after the estimator has committed to it. So the tables are
 * written, read back with this repository's own EMS reader, and run through the
 * same verification pass a real export goes through. Zero findings against the
 * sheet they were built from, or the writer is wrong.
 *
 * The second check is shape: the field headers must match the ones a REAL CCC
 * export writes — same names, same dBase types, same widths — because a
 * fixed-width table with a field one byte off is unreadable from that field on.
 */
const NOW = new Date(Date.UTC(2026, 8, 7));
const fixture = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

const cccWords: MitchellPageWord[] = (
  JSON.parse(fixture("tests/fixtures/ccc-1259209948-words.json")) as Array<{
    p: number;
    x: number;
    y: number;
    w: number;
    t: string;
  }>
).map((word) => ({ page: word.p, x: word.x, y: word.y, width: word.w, height: 8, text: word.t }));

const cccSheet = buildRekeySheet({
  text: fixture("tests/fixtures/ccc-1259209948-text.txt"),
  sourceFile: "CCC Estimate.pdf",
  columns: readEstimateColumns(cccWords),
});
const mitchellSheet = buildRekeySheet({
  text: fixture("tests/fixtures/frk2-mitchell-text.txt"),
  sourceFile: "Mitchell Estimate.pdf",
});

/**
 * "C" is the CIECA code both real exports in this repository carry, and the
 * code the verification gate requires of a keyed side. Nothing defaults to it:
 * the writer asserts no provenance the caller has not chosen, and the test
 * below covers the unset case.
 */
const roundTrip = (sheet: ReturnType<typeof buildRekeySheet>) => {
  const written = buildEmsExport({ sheet, stem: "rekey001", estimatingSystem: "C", now: NOW });
  const bundle = readEmsBundle(written.files);
  const keyed = keyedEstimateFromEms(bundle, "rekey001.zip");
  if (!keyed.ok) throw new Error(keyed.reason);
  return { written, bundle, keyed: keyed.estimate, verification: verifyRekey({ sheet, keyed: keyed.estimate }) };
};

describe("the export reads back as the sheet it was written from", () => {
  const ccc = roundTrip(cccSheet);

  it("produces tables this repository's own reader accepts", () => {
    expect(ccc.bundle.errors).toEqual([]);
    expect(ccc.bundle.tableNames).toEqual(["ad1", "env", "lin", "pfl", "pfm", "pft", "stl", "ttl", "veh"]);
  });

  it("carries every keyable line, and no line the sheet holds back", () => {
    const keyable = cccSheet.rows.filter((row) => row.keyable).length;
    // The reader collapses an export's per-labor records back onto one line,
    // and the group headings are lines of their own, exactly as the reference
    // export writes them.
    const headings = cccSheet.groups.filter((group) => group.rows.some((row) => row.keyable)).length;
    expect(ccc.keyed.lines.length).toBe(keyable + headings);
  });

  it("reports nothing against the sheet it came from", () => {
    // The acceptance criterion. Any finding here is the writer's, not a
    // rekey's: both sides are the same estimate.
    const deltas = ccc.verification.lineFindings.flatMap((finding) => finding.deltas);
    expect(deltas).toEqual([]);
    expect(ccc.verification.identity.verdict).toBe("match");
  });

  it("closes on the totals and the tax", () => {
    expect(ccc.keyed.totals.grandTotal).toBe(12138.16);
    expect(ccc.keyed.totals.tax).toBe(687.07);
    const off = ccc.verification.totals.filter((row) => row.comparable && !row.matches);
    expect(off).toEqual([]);
  });

  it("writes the profile settings the sheet tells the estimator to set", () => {
    expect(ccc.keyed.profile.laborRates).toEqual(
      expect.arrayContaining([
        { code: "LAB", rate: 75 },
        { code: "LAR", rate: 75 },
      ])
    );
    expect(ccc.keyed.profile.materialsRate).toBe(60);
    // The keyed side carries no tax rate of its own; it is read off the raw
    // export, which is where the receiving system reads it too.
    expect(normalizeEmsEstimate(ccc.bundle).profile.taxRate).toBeCloseTo(6, 2);
  });

  it("does the same for the other platform's estimate", () => {
    const mitchell = roundTrip(mitchellSheet);
    expect(mitchell.bundle.errors).toEqual([]);
    expect(mitchell.verification.lineFindings.flatMap((finding) => finding.deltas)).toEqual([]);
    expect(mitchell.keyed.totals.grandTotal).toBe(12496.54);
  });
});

describe("the tables are shaped like a real export's", () => {
  const reference = (extension: string) => {
    const dir = path.join(process.cwd(), "tests/fixtures/ems-ccc-1259209948");
    const name = fs.readdirSync(dir).find((entry) => entry.toLowerCase().endsWith(`.${extension}`))!;
    return parseDbaseTable(extension, new Uint8Array(fs.readFileSync(path.join(dir, name))))!;
  };
  const written = buildEmsExport({ sheet: cccSheet, stem: "rekey001", estimatingSystem: "C", now: NOW });
  const readBack = (extension: string) => {
    const file = written.files.find((entry) => entry.filename.endsWith(`.${extension}`))!;
    return parseDbaseTable(extension, file.bytes)!;
  };

  it("matches the reference export field for field", () => {
    for (const extension of ["env", "veh", "ad1", "lin", "stl", "ttl", "pfl", "pfm", "pft"]) {
      const ours = readBack(extension);
      const theirs = reference(extension);
      // Memo fields are deliberately absent — this writer carries no memo
      // content and will not declare a memo field with no .dbt behind it.
      const expected = theirs.fields.filter((field) => field.type !== "M");
      expect(`${extension}: ${ours.fields.map((f) => `${f.name}/${f.type}${f.length}.${f.decimals}`).join(" ")}`).toBe(
        `${extension}: ${expected.map((f) => `${f.name}/${f.type}${f.length}.${f.decimals}`).join(" ")}`
      );
    }
  });

  it("writes the group headings the way the reference export does", () => {
    const lin = readBack("lin");
    const headings = lin.records.filter((record) => !record.PART_TYPE && !record.MOD_LBR_TY && record.LINE_DESC);
    expect(headings.map((record) => String(record.LINE_DESC))).toContain("FRONT BUMPER & GRILLE");
  });

  it("repeats a line's part columns across its labor records, as the reference does", () => {
    // A replace-and-refinish line is two records in an export. The reference
    // writes the part columns on both; the reader takes the price once.
    const lin = readBack("lin");
    const byLine = new Map<number, number>();
    for (const record of lin.records) {
      const line = Number(record.LINE_NO);
      byLine.set(line, (byLine.get(line) ?? 0) + 1);
    }
    expect([...byLine.values()].some((count) => count > 1)).toBe(true);
  });
});

describe("dBase values are written the way dBase stores them", () => {
  it("right-aligns numbers at their declared scale and left-aligns text", () => {
    expect(formatDbaseValue(461.44, ["ACT_PRICE", "N", 9, 2])).toBe("   461.44");
    expect(formatDbaseValue(0, ["MISC_AMT", "N", 9, 2])).toBe("     0.00");
    expect(formatDbaseValue("LAB", ["MOD_LBR_TY", "C", 4, 0])).toBe("LAB ");
    expect(formatDbaseValue(true, ["TAX_PART", "L", 1, 0])).toBe("T");
    expect(formatDbaseValue(false, ["TAX_PART", "L", 1, 0])).toBe("F");
  });

  it("writes nothing rather than a zero for a value the sheet does not have", () => {
    // An export that writes 0.00 for "not stated" is what made a zero read as
    // a value on the way back in; the writer must not create that noise.
    expect(formatDbaseValue(null, ["ACT_PRICE", "N", 9, 2])).toBe("         ");
    expect(formatDbaseValue(null, ["TAX_PART", "L", 1, 0])).toBe(" ");
  });

  it("keeps the record length the header declares", () => {
    const bytes = writeDbaseTable({
      fields: [
        ["LINE_NO", "N", 3, 0],
        ["LINE_DESC", "C", 40, 0],
      ],
      records: [{ LINE_NO: 7, LINE_DESC: "Frt Bumper Cover" }],
      now: NOW,
    });
    const table = parseDbaseTable("lin", bytes)!;
    expect(table.records).toEqual([{ LINE_NO: 7, LINE_DESC: "Frt Bumper Cover" }]);
  });
});

describe("the export says what it cannot carry", () => {
  it("states that every line imports as a manual line", () => {
    const written = buildEmsExport({ sheet: cccSheet, stem: "rekey001", estimatingSystem: "C", now: NOW });
    expect(written.notes.join(" ")).toMatch(/MANUALLY ENTERED line/);
    expect(written.notes.join(" ")).toMatch(/no database reference and no database labor time/);
  });

  it("names the rows the sheet holds back from keying", () => {
    const written = buildEmsExport({ sheet: mitchellSheet, stem: "rekey001", estimatingSystem: "C", now: NOW });
    // The Mitchell totals page prints paint materials as a body line; the
    // sheet marks it "do not key" and routes it to the profile block, so it
    // must not travel as a line item either.
    expect(written.notes.join(" ")).toMatch(/do not key/);
  });

  it("asserts no producer the caller did not choose", () => {
    const anonymous = buildEmsExport({ sheet: cccSheet, stem: "rekey001", now: NOW });
    expect(anonymous.notes.join(" ")).toMatch(/identifies no estimating system/);
    // And the file then fails this repository's own gate, rather than passing
    // as something it is not.
    const keyed = keyedEstimateFromEms(readEmsBundle(anonymous.files), "rekey001.zip");
    expect(keyed.ok).toBe(false);
  });

  it("writes no workfile copy", () => {
    // WO-RK1 §1. Nothing here generates an AWF.
    const written = buildEmsExport({ sheet: cccSheet, stem: "rekey001", estimatingSystem: "C", now: NOW });
    expect(written.files.some((file) => /\.awf$/i.test(file.filename))).toBe(false);
  });
});

describe("the export is produced unless a deployment turns it off", () => {
  it("is on by default, and off only when asked", () => {
    // It shipped opt-in, which left every download offering a PDF and a ledger
    // and no artifact a receiving system reads — so nothing could be tested
    // against one. What is unproven is said in the notes instead.
    expect(isRekeyEmsWriterEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(isRekeyEmsWriterEnabled({ REKEY_EMS_WRITER_ENABLED: "true" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(isRekeyEmsWriterEnabled({ REKEY_EMS_WRITER_ENABLED: "false" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});
