import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildRekeySheet } from "../rekeyLedger";
import { readEmsBundle } from "../emsReader";
import { keyedEstimateFromEms, verifyRekey } from "../rekeyVerification";
import { readEstimateColumns, type MitchellPageWord } from "../mitchellColumnBands";
import { buildRekeyVerificationText } from "../rekeyReportBuilder";
import { resolveOperationCode } from "../rekeyVocabulary";

/**
 * RV-4 / RV-5 — what the verification report says when the two platforms
 * differ in how they WRITE something rather than in what was keyed.
 *
 * The pair is the real one: a Mitchell supplement and a CCC EMS export for
 * the same claim. Every finding it produces costs an estimator attention, so
 * a finding that is only the two formats disagreeing is worse than no
 * finding — it teaches him the report is noisy and to skim it.
 */
const sheet = buildRekeySheet({
  text: fs.readFileSync(path.join(process.cwd(), "tests/fixtures/frk1b-mitchell-text.txt"), "utf8"),
  sourceFile: "frk1b.pdf",
});
const emsDir = path.join(process.cwd(), "tests/fixtures/ems-rk1a");
const keyed = keyedEstimateFromEms(
  readEmsBundle(
    fs.readdirSync(emsDir).map((name) => ({ filename: name, bytes: new Uint8Array(fs.readFileSync(path.join(emsDir, name))) }))
  ),
  "ab7f6e93.zip"
);
if (!keyed.ok) throw new Error(keyed.reason);
const verification = verifyRekey({ sheet, keyed: keyed.estimate });
const deltas = (field: string) =>
  verification.lineFindings.flatMap((finding) =>
    finding.deltas.filter((delta) => delta.field === field).map((delta) => ({ line: finding.sourceLine, ...delta }))
  );
const row = (label: string) => verification.totals.find((entry) => entry.label === label);

describe("RV-5 — a line with no part has no quantity, however each side writes it", () => {
  it("does not report the print's blank cell against the export's zero", () => {
    // Five of the six quantity findings were labor-only lines: a hinge
    // repair, two R&I lines, a manual inspection. None of them has a part.
    expect(deltas("quantity").map((delta) => delta.line)).toEqual([5]);
    expect(deltas("quantity").every((delta) => delta.found !== "0" || delta.expected !== "not printed")).toBe(true);
  });

  it("keeps the quantity finding on a line that does carry a part", () => {
    // Line 5 is a $467.00 aftermarket bumper cover keyed at price 0, qty 0.
    // A zero quantity there is a difference, not a way of writing "none".
    expect(deltas("quantity")[0]).toMatchObject({ line: 5, expected: "1", found: "0" });
    expect(deltas("price").some((delta) => delta.line === 5)).toBe(true);
  });
});

describe("RV-5 — an operation is compared as an operation, not as a code", () => {
  it("names both operations so the finding can be read", () => {
    expect(deltas("operation").map((delta) => `${delta.line}: ${delta.expected} -> ${delta.found}`)).toEqual([
      "26: Rpr -> Algn (OP4)",
      "28: Rpr -> Algn (OP4)",
      "78: Manual -> Subl (OP16)",
      "84: Repl -> Manual (OP0)",
      "86: Manual -> Rpr (OP9)",
      "87: Repl -> Subl (OP16)",
    ]);
    // Before this the same six read "expected OP9, found OP4" — which names
    // neither operation, so nothing could be decided from them.
    expect(deltas("operation").every((delta) => !/^OP\d+$/.test(delta.expected))).toBe(true);
  });

  it("resolves a code to the operation it names, so equal operations do not differ", () => {
    expect(resolveOperationCode("OP4")).toBe("Algn");
    expect(resolveOperationCode("OP11")).toBe("Repl");
    expect(resolveOperationCode("OP99")).toBeNull();
  });
});

describe("RV-4 — sublet is reported against the sublet category", () => {
  it("puts the source's sublet dollars on the sublet row", () => {
    // $327.00 booked inside the labor categories (two scans, corrosion
    // protection, two car covers) plus a $12.00 taxed sublet-type part.
    expect(row("Sublet / miscellaneous")).toMatchObject({ code: "PAS", source: 339, comparable: true });
  });

  it("says where the source books them, rather than moving them silently", () => {
    expect(row("Sublet / miscellaneous")?.note).toContain("inside the labor categories");
    expect(buildRekeyVerificationText(verification)).toContain("inside the labor categories");
  });
});

describe("RV-4 — a category only one side carries is not a disagreement", () => {
  it("marks the export's own internal subtotals as nothing to compare", () => {
    for (const code of ["LAT", "PAN", "PAO", "MAPA", "UPD"]) {
      const entry = verification.totals.find((candidate) => candidate.code === code);
      expect(entry).toMatchObject({ source: null, comparable: false });
    }
    expect(buildRekeyVerificationText(verification)).toContain("nothing to compare");
  });

  it("marks a source category the export has no counterpart for the same way", () => {
    expect(row("Mechanical Labor")).toMatchObject({ source: 6.8, keyed: null, comparable: false });
  });

  it("counts only the rows both sides carry as off", () => {
    // 22 before: nine of the export's internal codes and four one-sided
    // source categories were each being counted as a failed comparison.
    expect(verification.summary.totalsRowsOff).toBe(9);
    expect(verification.totals.filter((entry) => entry.comparable && !entry.matches)).toHaveLength(9);
  });

  it("does not print a floating-point artifact for stacked tax lanes", () => {
    expect(row("Tax")?.source).toBe(637.49);
  });
});

/**
 * RV-5, measured against ground truth.
 *
 * The strongest check available to this repository: a CCC estimate verified
 * against the CCC EMS export OF THE SAME WORKFILE. Every line, price and hour
 * on the two sides is the same fact stated twice, so a finding here is a
 * finding about the READING, not about a rekey. It is where the noise classes
 * were measured — an export writes a figure in every column of every line,
 * zero where the line has none, and against a print that leaves the cell
 * empty that is the same absence written twice.
 */
describe("RV-5 — an export's zeros are not values", () => {
  const words: MitchellPageWord[] = (
    JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/ccc-1259209948-words.json"), "utf8")) as Array<{
      p: number;
      x: number;
      y: number;
      w: number;
      t: string;
    }>
  ).map((word) => ({ page: word.p, x: word.x, y: word.y, width: word.w, height: 8, text: word.t }));
  const cccSheet = buildRekeySheet({
    text: fs.readFileSync(path.join(process.cwd(), "tests/fixtures/ccc-1259209948-text.txt"), "utf8"),
    sourceFile: "CCC Estimate 1259209948.pdf",
    columns: readEstimateColumns(words),
  });
  const emsDir = path.join(process.cwd(), "tests/fixtures/ems-ccc-1259209948");
  const own = keyedEstimateFromEms(
    readEmsBundle(
      fs
        .readdirSync(emsDir)
        .map((name) => ({ filename: name, bytes: new Uint8Array(fs.readFileSync(path.join(emsDir, name))) }))
    ),
    "4b53232a.zip"
  );
  if (!own.ok) throw new Error(own.reason);
  const check = verifyRekey({ sheet: cccSheet, keyed: own.estimate });
  const cccRow = (code: string) => check.totals.find((entry) => entry.code === code);

  it("does not report a zero against a cell the print leaves empty", () => {
    // The two documents ARE the same workfile, so every remaining finding is
    // one fact: the print marks a manual charge miscellaneous and its own
    // export books the identical dollars as a price.
    //
    // Thirteen, not twelve: the thirteenth is "Raw plastic primer (Per raw
    // plastic panel)", whose description is longer than the 40 characters an
    // EMS export gives LINE_DESC. Cut off one letter into its last word it
    // matched nothing, and the same line was reported twice — once as never
    // keyed, once as keyed but not in the source — until the matcher learned
    // to read a keyed description as a prefix of the source's.
    const counts = check.lineFindings
      .flatMap((finding) => finding.deltas)
      .reduce<Record<string, number>>((totals, delta) => ({ ...totals, [delta.field]: (totals[delta.field] ?? 0) + 1 }), {});
    // Fourteen would mean line 5 had been mispaired: the sheet reads its
    // operation off "Rpl information labels" without editing the words, so it
    // still pairs with the export's own line 5 rather than with the
    // INFORMATION LABELS heading above it.
    expect(counts).toEqual({ "charge column": 13 });
    expect(check.summary.exact).toBe(82);
    expect(check.summary.missing).toBe(0);
    expect(check.summary.unmatched).toBe(0);
    expect(check.identity.verdict).toBe("match");
  });

  /**
   * The materials mapping, measured on the one pair where both sides are the
   * same workfile — so a difference here can only be the reading.
   */
  it("answers a printed materials line with the export's materials total", () => {
    // The print states one line: "Paint Supplies 17.3 hrs @ $60.00/hr
    // 1,038.00". The export splits the identical money by stage —
    // $756.00 MAPA + $0.00 MASH + $66.00 MA2S + $216.00 MABL = $1,038.00 —
    // so the paint stage alone answered the line $282.00 short and reported
    // a disagreement between a document and its own export.
    const stages = ["MAPA", "MASH", "MA2S", "MABL"].map((code) => cccRow(code)?.keyed ?? 0);
    expect(stages.reduce((total, stage) => total + stage, 0)).toBeCloseTo(1038, 2);

    expect(cccRow("MAT")).toMatchObject({
      label: "Paint Supplies",
      source: 1038,
      keyed: 1038,
      matches: true,
      comparable: true,
    });
    // The stages stay on the table as what they are: figures only the export
    // states, reported rather than compared.
    expect(cccRow("MAPA")).toMatchObject({ source: null, keyed: 756, comparable: false });
  });

  it("nets a roll-up only of the members the page states on their own lines", () => {
    // This page states no materials stage of its own, so nothing is netted
    // out of the materials total. It DOES state miscellaneous separately, and
    // the export's parts total rolls sublet in — so the parts comparison is
    // the export's PAT less the PAS the page prints below it, rather than the
    // same $1,664.95 answering two rows.
    expect(cccRow("MAT")?.note ?? "").not.toMatch(/states on lines of their own/);
    expect(cccRow("PAT")).toMatchObject({ source: 5314.38, keyed: 5440.64 });
    expect(cccRow("PAT")?.note).toMatch(/less PAS, which this page states on lines of their own/);
    expect(check.summary.totalsRowsOff).toBe(2);
  });
});

/**
 * RV-10 — the same part number, written two ways.
 *
 * One platform prints "88723-06130" and the other writes "8872306130". The
 * matcher already treats those as the same part — it pairs the two lines on
 * exactly that equivalence — and then the comparison reported the raw forms as
 * a difference. On the real cross-platform pair that was 24 findings of 83
 * rows: noise sitting on top of the differences an estimator opened the report
 * for.
 */
describe("RV-10 — a part number is compared the way it is matched", () => {
  const mitchellSheet = buildRekeySheet({
    text: fs.readFileSync(path.join(process.cwd(), "tests/fixtures/frk2-mitchell-text.txt"), "utf8"),
    sourceFile: "Mitchell Estimate.pdf",
  });
  const cccDir = path.join(process.cwd(), "tests/fixtures/ems-ccc-1259209948");
  const keyed = keyedEstimateFromEms(
    readEmsBundle(
      fs.readdirSync(cccDir).map((name) => ({
        filename: name,
        bytes: new Uint8Array(fs.readFileSync(path.join(cccDir, name))),
      }))
    ),
    "ccc.zip"
  );
  if (!keyed.ok) throw new Error(keyed.reason);
  const check = verifyRekey({ sheet: mitchellSheet, keyed: keyed.estimate });
  const partNumberDeltas = check.lineFindings
    .flatMap((finding) => finding.deltas)
    .filter((delta) => delta.field === "part number");

  it("reports only the numbers that are actually different", () => {
    // One survives on this pair, and it is a real difference: the two files
    // carry different suffixes on the same clip.
    expect(partNumberDeltas).toHaveLength(1);
    expect(partNumberDeltas[0]).toMatchObject({ expected: "90467-07049-23", found: "9046707049C0" });
  });

  it("still pairs the lines it stopped reporting", () => {
    // The lines did not go missing when the finding did.
    const label = check.lineFindings.find((finding) => /Inform Label Cooler Caution/i.test(finding.description));
    expect(label?.matchedBy).toBe("part number");
    expect(label?.deltas.some((delta) => delta.field === "part number")).toBe(false);
  });
});

/**
 * RV-11 — a code that came from the LINE, read off a lane it cannot describe.
 *
 * The pair here is the frk2 Mitchell estimate against the CCC export for the
 * same claim. One platform repeats a line's operation code on every labor
 * lane of the line: three lines in this export carry OP11 on their body lane
 * AND on their refinish lane. It writes that same OP11 on a prep line whose
 * only lane is refinish, with no part number and no price — and against the
 * sheet's refinish row that read as "the operation should be Refn, it is Repl
 * (OP11)", sending an estimator to a line nobody keyed wrong.
 */
describe("RV-11 — a part operation cannot describe a refinish lane with no part", () => {
  const frk2 = buildRekeySheet({
    text: fs.readFileSync(path.join(process.cwd(), "tests/fixtures/frk2-mitchell-text.txt"), "utf8"),
    sourceFile: "frk2.pdf",
  });
  const cccDir = path.join(process.cwd(), "tests/fixtures/ems-ccc-1259209948");
  const cccKeyed = keyedEstimateFromEms(
    readEmsBundle(
      fs.readdirSync(cccDir).map((name) => ({ filename: name, bytes: new Uint8Array(fs.readFileSync(path.join(cccDir, name))) }))
    ),
    "ccc.zip"
  );
  if (!cccKeyed.ok) throw new Error(cccKeyed.reason);
  const check = verifyRekey({ sheet: frk2, keyed: cccKeyed.estimate });

  it("is the shape the export actually writes", () => {
    // Not asserted from the rule — read off the export, which is what makes
    // the rule true. The prep line: a refinish lane, an OP11, and no part.
    const prep = cccKeyed.estimate.lines.find((line) => line.lineNumber === 31);
    expect(prep).toMatchObject({ description: "Prep unprimed bumper", partNumber: null, price: 0, operationLane: "LAR" });
    expect(prep?.operation).toBe("OP11");
    expect(resolveOperationCode("OP11")).toBe("Repl");
  });

  it("reports no operation difference against the sheet's refinish row", () => {
    const prep = check.lineFindings.find((finding) => finding.sourceLine === 12);
    expect(prep?.description).toBe("Prep unprimed bumper");
    expect(prep?.deltas).toEqual([]);
    expect(prep?.resolution).toBe("exact");
  });

  it("stays narrow: a code that CAN describe the lane still speaks", () => {
    // "Tint color" is coded OP0 on its refinish lane — a manual entry, which
    // is that line's own classification and not another line's code showing
    // through. The sheet says Refn, and the difference is reported.
    const tint = check.lineFindings.find((finding) => finding.sourceLine === 89);
    expect(tint?.deltas.map((delta) => `${delta.field}: ${delta.expected} vs ${delta.found}`)).toEqual([
      "operation: Refn vs Manual (OP0)",
    ]);
  });

  it("leaves the other real pairs where they were", () => {
    // The lane-level codes of the other platform's export name no part
    // operation, so nothing there is withheld.
    const operationDeltas = check.lineFindings.flatMap((finding) =>
      finding.deltas.filter((delta) => delta.field === "operation")
    );
    expect(operationDeltas).toHaveLength(33);
    expect(check.summary.exact).toBe(13);
  });
});
