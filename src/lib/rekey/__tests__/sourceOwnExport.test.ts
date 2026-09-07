import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildRekeySheet } from "../rekeyLedger";
import JSZip from "jszip";
import { classifyEmsSelection, normalizeEmsEstimate, readEmsBundle } from "../emsReader";
import { explainKeyedExport, isSourceOwnExport, keyedEstimateFromEms, verifyRekey } from "../rekeyVerification";
import { isManualEntry } from "../emsSourceRows";
import { readEstimateColumns } from "../mitchellColumnBands";

/**
 * The SOURCE estimate's own EMS export, uploaded as the second file.
 *
 * A shop's export folder holds the estimate, its BMS xml and its EMS export —
 * and a shop that wants the rekey applied uploads all three, because those are
 * "the estimate and its own files". None of it is a rekey of anything, so the
 * gate refuses it, correctly. What it said was wrong: it named a
 * shop-versus-carrier comparison and pointed at the Estimate Delta report,
 * which is about a comparison nobody asked for and describes the wrong file.
 *
 * The fixture is the real Mitchell EMS export of the same claim as the
 * Mitchell estimate fixture — uppercase extensions, per-table stems
 * (9508501A.AD1, 9508501V.VEH), exactly as Mitchell writes them.
 */
const dir = path.join(process.cwd(), "tests/fixtures/ems-mitchell-1259209948");
const files = () =>
  fs.readdirSync(dir).map((name) => ({
    filename: name,
    bytes: new Uint8Array(fs.readFileSync(path.join(dir, name))),
  }));
const sheet = buildRekeySheet({
  text: fs.readFileSync(path.join(process.cwd(), "tests/fixtures/frk2-mitchell-text.txt"), "utf8"),
  sourceFile: "Mitchell Estimate.pdf",
});

describe("a Mitchell EMS export reads as cleanly as a CCC one", () => {
  const bundle = readEmsBundle(files());

  it("reads every table the other platform writes", () => {
    // Nothing in the reader is CCC-specific: the dBase header self-describes,
    // and Mitchell's per-table stems and uppercase extensions change nothing.
    expect(bundle.errors).toEqual([]);
    expect(bundle.tableNames).toEqual(["ad1", "ad2", "env", "lin", "pfh", "pfl", "pfm", "pfo", "pfp", "pft", "stl", "ttl", "veh"]);
  });

  it("agrees with the printed estimate to the cent", () => {
    const estimate = normalizeEmsEstimate(bundle);
    expect(estimate.estimatingSystem).toBe("M");
    expect(estimate.lines).toHaveLength(93);
    expect(estimate.totals.grandTotal).toBe(12496.54);
    expect(estimate.totals.tax).toBe(707.35);
    expect(estimate.vin).toBe(sheet.identity.vin);
  });
});

describe("the refusal names the file the estimator actually uploaded", () => {
  const bundle = readEmsBundle(files());
  const refused = keyedEstimateFromEms(bundle, "29508501.zip");

  it("still refuses it as a keyed side", () => {
    // Verification proves a rekey closed against its source. The source's own
    // export proves nothing about a rekey that has not happened yet.
    expect(refused.ok).toBe(false);
  });

  it("says it is the source's own export, not a comparison to run elsewhere", () => {
    if (refused.ok) throw new Error("expected the gate to refuse this export");
    const explained = explainKeyedExport({ sheet, bundle, reason: refused.reason });
    expect(explained).toMatch(/SOURCE estimate's own/);
    expect(explained).toMatch(/same VIN as the sheet/);
    expect(explained).toMatch(/93 lines/);
    expect(explained).toMatch(/nothing to verify against yet/);
    expect(explained).not.toMatch(/Estimate Delta/);
  });

  it("leaves the gate's own words alone for an export of another vehicle", () => {
    const other = buildRekeySheet({
      text: fs.readFileSync(path.join(process.cwd(), "tests/fixtures/frk1b-mitchell-text.txt"), "utf8"),
      sourceFile: "other.pdf",
    });
    if (refused.ok) throw new Error("expected the gate to refuse this export");
    // F-RK1b is a different claim and VIN, so this export is not its source's
    // own and the gate's own explanation stands.
    expect(explainKeyedExport({ sheet: other, bundle, reason: refused.reason })).toBe(refused.reason);
  });
});

describe("an archive inside a selection is opened, not thrown away", () => {
  it("finds the tables inside a zip picked alongside the estimate and its xml", async () => {
    // What the shop actually selected: the export zipped up, the BMS xml and
    // the estimate PDF, all sitting in one folder. The zip WAS the export, and
    // discarding it produced "no EMS tables were found in that selection".
    const zip = new JSZip();
    for (const file of files()) zip.file(file.filename, file.bytes);
    const archived = new Uint8Array(await zip.generateAsync({ type: "uint8array" }));

    const selection = classifyEmsSelection([
      { filename: "1259209948.xml", bytes: new Uint8Array([60, 63, 120, 109, 108]) },
      { filename: "29508501.zip", bytes: archived },
      { filename: "Mitchell Estimate 1259209948.pdf", bytes: new Uint8Array([37, 80, 68, 70]) },
    ]);
    expect(selection.tables).toEqual([]);
    expect(selection.archives.map((entry) => entry.filename)).toEqual(["29508501.zip"]);
    expect(selection.skipped).toEqual(["1259209948.xml", "Mitchell Estimate 1259209948.pdf"]);

    // Opened, its contents classify as the export they are.
    const inner = classifyEmsSelection(files());
    expect(inner.tables).toHaveLength(13);
    expect(readEmsBundle(inner.tables).errors).toEqual([]);
  });

  it("keeps loose tables and an archive in the same selection", () => {
    const selection = classifyEmsSelection([
      ...files().slice(0, 2),
      { filename: "extra.zip", bytes: new Uint8Array([0x50, 0x4b, 3, 4, 0]) },
    ]);
    expect(selection.tables).toHaveLength(2);
    expect(selection.archives).toHaveLength(1);
  });
});

/**
 * The export used as the sheet's LINE DATA.
 *
 * The sheet is read off a page; the export states the same values as data. The
 * merge takes the values and leaves everything only the print carries — the
 * section headings, the notes, the totals page — alone.
 */
describe("the source's own export supplies the line values", () => {
  const estimate = normalizeEmsEstimate(readEmsBundle(files()));
  const withExport = buildRekeySheet({
    text: fs.readFileSync(path.join(process.cwd(), "tests/fixtures/frk2-mitchell-text.txt"), "utf8"),
    sourceFile: "Mitchell Estimate.pdf",
    sourceExport: estimate,
  });

  it("is recognized as the source's own, on the VIN both carry", () => {
    expect(isSourceOwnExport({ sheet, estimate })).toEqual({ yes: true, matchedOn: "VIN" });
  });

  it("keeps the sheet closing to the cent", () => {
    // The merge must not disturb the arithmetic: the totals page is the
    // print's, and the rows now carry the export's own figures.
    expect(withExport.derivedTotals?.check).toMatchObject({ printedGrandTotal: 12496.54, delta: 0, closes: true });
    expect(withExport.reconciliation.closes).toBe(true);
    expect(withExport.warnings).toEqual([]);
  });

  it("confirms the page reading rather than correcting it, on this document", () => {
    // Worth stating plainly: on this pair the export AGREES with the page.
    // Every row still resolves its operation, every price is unchanged, and
    // the sheet is the same size — which is evidence about the reading, not a
    // reason to distrust the merge.
    expect(withExport.rows).toHaveLength(sheet.rows.length);
    expect(withExport.stats.unmappedOperations).toBe(0);
    const priceOf = (rows: typeof sheet.rows, line: number) => rows.find((row) => row.sourceLine === line)?.price;
    for (const line of [1, 5, 17, 24, 33, 35, 44, 79]) {
      expect(priceOf(withExport.rows, line)).toBe(priceOf(sheet.rows, line));
    }
  });

  it("leaves the keying description alone", () => {
    // The print spells the operation into the description ("Remove Replace Frt
    // Bumper Cover"), and the reading that resolves the operation is the same
    // reading that lifts those words out. Supplying the operation from the
    // export settled it separately and left the words behind: 73 of 84 keying
    // descriptions came out with "Remove Replace" or "Repair" on the front.
    const before = new Map(sheet.rows.map((row) => [row.id, row.descriptionCcc]));
    const changed = withExport.rows.filter((row) => before.get(row.id) !== row.descriptionCcc);
    expect(changed).toEqual([]);
    expect(withExport.rows.some((row) => /^(?:remove replace|repair)\b/i.test(row.descriptionCcc))).toBe(false);
  });

  it("keeps what only the print carries", () => {
    // The export has no section headings, no totals page and no line notes.
    expect(withExport.groups.map((group) => group.group)).toEqual(sheet.groups.map((group) => group.group));
    expect(withExport.expectedTotals?.grandTotal).toBe(12496.54);
    expect(withExport.rows.some((row) => row.notes.length > 0)).toBe(true);
  });

  it("does not carry a marker word into the part-number column", () => {
    // This export writes the literal word "Sublet" in ALT_PARTNO on every
    // sublet line. It is not a part number and must never reach the column an
    // estimator orders from.
    const sublet = withExport.rows.filter((row) => row.partTypeCcc === "Sublet");
    expect(sublet.length).toBeGreaterThan(0);
    expect(sublet.every((row) => row.partNumber === null)).toBe(true);
  });

  it("repairs a print this build cannot read cleanly", () => {
    // The case the merge exists for. The CCC print welds quantity onto price,
    // and without the page geometry that reads a thousand dollars over on
    // every part line: $15,346.23 of parts against a printed $5,314.38. With
    // the estimate's own export supplying the values, the same unreadable
    // page produces $5,440.64 — the remaining $126.26 is the export's own
    // classification of other parts, not a reading error.
    const cccDir = path.join(process.cwd(), "tests/fixtures/ems-ccc-1259209948");
    const cccExport = normalizeEmsEstimate(
      readEmsBundle(
        fs.readdirSync(cccDir).map((name) => ({
          filename: name,
          bytes: new Uint8Array(fs.readFileSync(path.join(cccDir, name))),
        }))
      )
    );
    const text = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/ccc-1259209948-text.txt"), "utf8");
    const parts = (built: ReturnType<typeof buildRekeySheet>) =>
      built.derivedTotals?.categories.find((category) => /^parts$/i.test(category.category))?.cost;
    expect(parts(buildRekeySheet({ text, sourceFile: "ccc.pdf" }))).toBeCloseTo(15346.23, 2);
    expect(parts(buildRekeySheet({ text, sourceFile: "ccc.pdf", sourceExport: cccExport }))).toBeCloseTo(5440.64, 2);
  });
});

/**
 * The manual-entry marker, taken from the export instead of inferred.
 *
 * An estimating system writes its own reference on every line it pulled from
 * the parts and labor database, and a manual-entry code on every line the
 * estimator typed. That is the system's word for it — the sheet had been
 * reasoning about the same fact from what the page showed.
 */
describe("a line the estimator typed, stated by the export", () => {
  const estimate = normalizeEmsEstimate(readEmsBundle(files()));
  const withExport = buildRekeySheet({
    text: fs.readFileSync(path.join(process.cwd(), "tests/fixtures/frk2-mitchell-text.txt"), "utf8"),
    sourceFile: "Mitchell Estimate.pdf",
    sourceExport: estimate,
  });
  const flagged = withExport.rows.filter((row) => row.flags.includes("no database entry"));

  it("marks every line the export marks, and no other", () => {
    // The same estimate's BMS carries ManualLineInd=1 on 29 lines. Two files
    // written by the same system from the same workfile, agreeing.
    expect(estimate.lines.filter((line) => isManualEntry(line.databaseRef))).toHaveLength(29);
    expect(flagged).toHaveLength(29);
    expect(flagged.map((row) => row.sourceLine)).toEqual([
      8, 10, 11, 12, 23, 31, 32, 38, 41, 45, 48, 50, 64, 65, 71, 77, 79, 80, 81, 82, 84, 85, 86, 88, 89, 90, 91, 92, 93,
    ]);
  });

  it("says what it means for the keying", () => {
    expect(flagged[0].notes.join(" ")).toMatch(/typed by the estimator rather than taken from its parts and labor database/);
    expect(flagged[0].notes.join(" ")).toMatch(/Key it as a manual line/);
  });

  it("confirms the reading the sheet made from the page alone", () => {
    // Every row this build called a charge because the print stated a part
    // type with no part number is a row the export independently marks as
    // typed. The inference and the system's own marker agree, 15 for 15.
    const numberless = withExport.rows.filter((row) => row.flags.includes("part number: not printed"));
    expect(numberless).toHaveLength(15);
    expect(numberless.every((row) => row.flags.includes("no database entry"))).toBe(true);
  });

  it("changes no figure on the sheet", () => {
    expect(withExport.derivedTotals?.check).toMatchObject({ delta: 0, closes: true });
  });

  it("is positive evidence only", () => {
    // One platform writes this reference on every line; the other leaves the
    // field empty throughout. A line with no marker is a line nothing is known
    // about — never a line proved to be database-backed.
    expect(isManualEntry(null)).toBe(false);
    expect(isManualEntry("")).toBe(false);
    expect(isManualEntry("   ")).toBe(false);
    expect(isManualEntry("203597")).toBe(false);

    const cccDir = path.join(process.cwd(), "tests/fixtures/ems-ccc-1259209948");
    const cccExport = normalizeEmsEstimate(
      readEmsBundle(
        fs.readdirSync(cccDir).map((name) => ({
          filename: name,
          bytes: new Uint8Array(fs.readFileSync(path.join(cccDir, name))),
        }))
      )
    );
    expect(cccExport.lines.every((line) => (line.databaseRef ?? "") === "")).toBe(true);
    const text = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/ccc-1259209948-text.txt"), "utf8");
    const ccc = buildRekeySheet({ text, sourceFile: "ccc.pdf", sourceExport: cccExport });
    expect(ccc.rows.some((row) => row.flags.includes("no database entry"))).toBe(false);
  });
});

/**
 * RV-9 — a description cut off at the export's field width.
 *
 * CIECA EMS gives LINE_DESC 40 characters. A longer description arrives cut
 * off, and on the real CCC pair that is "Raw plastic primer (Per raw plastic
 * pane" — one letter short of its own last word. Every description key missed
 * it, and the line was reported twice: once as never keyed, once as keyed but
 * not in the source. That is the failure the matcher's operation-free key
 * exists to prevent, arriving through the field width instead.
 */
describe("a keyed description may be a truncated form of the source's", () => {
  const dir = path.join(process.cwd(), "tests/fixtures/ems-ccc-1259209948");
  const bundle = readEmsBundle(
    fs.readdirSync(dir).map((name) => ({
      filename: name,
      bytes: new Uint8Array(fs.readFileSync(path.join(dir, name))),
    }))
  );
  // With the page's own column bands, as the build reads a real CCC PDF.
  const words = (
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
    sourceFile: "CCC Estimate.pdf",
    columns: readEstimateColumns(words),
  });
  const keyed = keyedEstimateFromEms(bundle, "ccc.zip");
  if (!keyed.ok) throw new Error(keyed.reason);

  it("pairs the line instead of reporting it as both missing and extra", () => {
    const truncated = keyed.estimate.lines.find((line) => /^Raw plastic primer/i.test(line.description ?? ""));
    expect(truncated?.description).toBe("Raw plastic primer (Per raw plastic pane");
    expect(truncated?.description).toHaveLength(40);

    const check = verifyRekey({ sheet: cccSheet, keyed: keyed.estimate });
    const finding = check.lineFindings.find((entry) => /^Raw plastic primer/i.test(entry.description));
    expect(finding?.resolution).not.toBe("missing_in_keyed");
    expect(finding?.matchedBy).toBe("description");
    expect(check.extraLines.some((line) => /^Raw plastic primer/i.test(line.description ?? ""))).toBe(false);
  });

  it("does not let a short name stand for a longer one", () => {
    // The prefix rule has a floor: below it a name is short enough to be a
    // different part's whole name, and pairing on it would be a guess.
    const check = verifyRekey({ sheet: cccSheet, keyed: keyed.estimate });
    expect(check.summary.unmatched).toBe(0);
    expect(check.summary.missing).toBe(0);
    // Every pairing still reports the same single fact about this pair.
    const fields = new Set(check.lineFindings.flatMap((entry) => entry.deltas).map((delta) => delta.field));
    expect([...fields]).toEqual(["charge column"]);
  });
});

/**
 * WHICH export this is, decided by the platform that wrote the source.
 *
 * The workfile someone keyed the sheet into and the source estimate's own
 * export arrive through the same upload and carry the same VIN. Identity
 * cannot separate them. The platform can: an export from the system that wrote
 * the source estimate is that estimate's own; an export from the other system
 * is the rekey.
 */
describe("the source's platform decides what the second upload is", () => {
  const mitchellText = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/frk2-mitchell-text.txt"), "utf8");
  const cccText = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/ccc-1259209948-text.txt"), "utf8");
  const cccBundle = readEmsBundle(
    fs.readdirSync(path.join(process.cwd(), "tests/fixtures/ems-ccc-1259209948")).map((name) => ({
      filename: name,
      bytes: new Uint8Array(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/ems-ccc-1259209948", name))),
    }))
  );
  const mitchellExport = normalizeEmsEstimate(readEmsBundle(files()));
  const cccExport = normalizeEmsEstimate(cccBundle);
  const mitchellSheet = buildRekeySheet({ text: mitchellText, sourceFile: "m.pdf" });
  // Text only, to prove the platform is named without page geometry.
  const cccSheet = buildRekeySheet({ text: cccText, sourceFile: "c.pdf" });
  // With the page's own bands, as the build reads a real CCC PDF.
  const cccPageWords = (
    JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/ccc-1259209948-words.json"), "utf8")) as Array<{
      p: number;
      x: number;
      y: number;
      w: number;
      t: string;
    }>
  ).map((word) => ({ page: word.p, x: word.x, y: word.y, width: word.w, height: 8, text: word.t }));
  const cccColumns = readEstimateColumns(cccPageWords);
  const cccMeasured = buildRekeySheet({ text: cccText, sourceFile: "c.pdf", columns: cccColumns });

  it("names the platform from the print's own header", () => {
    expect(mitchellSheet.sourcePlatform).toBe("mitchell");
    // The CCC print's column header survives extraction as one welded run, so
    // the platform is known even with no page geometry to measure.
    expect(cccSheet.sourcePlatform).toBe("ccc");
    expect(buildRekeySheet({ text: "nothing an estimate would print", sourceFile: "x.pdf" }).sourcePlatform).toBeNull();
  });

  it("reads an export from the source's own system as the source's own", () => {
    expect(isSourceOwnExport({ sheet: mitchellSheet, estimate: mitchellExport }).yes).toBe(true);
    // This is the change: a CCC export against a CCC-sourced sheet used to be
    // verified as a rekey, and reported 13 findings and a failed pass against
    // an estimate nobody had rekeyed.
    expect(isSourceOwnExport({ sheet: cccSheet, estimate: cccExport }).yes).toBe(true);
  });

  it("reads an export from the OTHER system as the rekey, and verifies it", () => {
    expect(isSourceOwnExport({ sheet: mitchellSheet, estimate: cccExport }).yes).toBe(false);
    const keyed = keyedEstimateFromEms(cccBundle, "ccc.zip");
    expect(keyed.ok).toBe(true);
  });

  it("asserts nothing when the print does not say which platform wrote it", () => {
    const unknown = buildRekeySheet({ text: "nothing an estimate would print", sourceFile: "x.pdf" });
    expect(isSourceOwnExport({ sheet: unknown, estimate: cccExport }).yes).toBe(false);
  });

  it("takes the part a line works on without calling it a part to buy", () => {
    // CCC writes PART_TYPE "PAO" and the part number on an R&I line — the part
    // the operation works on, which the line does not buy and its print does
    // not type. Carrying the number while letting the part type fall back to
    // OEM turned 25 R&I and align lines into parts to order.
    const merged = buildRekeySheet({ text: cccText, sourceFile: "c.pdf", columns: cccColumns, sourceExport: cccExport });
    const sideSupport = merged.rows.find((row) => row.sourceLine === 15);
    expect(sideSupport).toMatchObject({
      descriptionCcc: "RT Side support",
      operationCcc: "R&I",
      partNumber: "5211506050",
      partTypeCcc: "None",
      partTypeEms: null,
      price: null,
    });
    const oem = (built: ReturnType<typeof buildRekeySheet>) => built.rows.filter((row) => row.partTypeCcc === "OEM").length;
    expect(oem(merged)).toBe(oem(cccMeasured));
    expect(merged.rows.filter((row) => row.partNumber).length).toBe(
      cccMeasured.rows.filter((row) => row.partNumber).length + 25
    );
    expect(merged.derivedTotals?.check).toMatchObject({ delta: 0, closes: true });
  });
});

/**
 * The fourth pairing: a source estimate from one platform, and an export from
 * the other that is NOT this build's rekey target.
 *
 * Either platform's estimate can be the source, but the sheet still translates
 * into CCC only. So a Mitchell workfile export against a CCC-sourced sheet is
 * refused — correctly — and the refusal has to say what the file is rather
 * than sending the estimator off to a comparison report on what may be their
 * own rekeyed workfile.
 */
describe("an export from a platform this sheet does not key into", () => {
  const cccWords = (
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
    sourceFile: "CCC Estimate.pdf",
    columns: readEstimateColumns(cccWords),
  });
  const bundle = readEmsBundle(files());
  const estimate = normalizeEmsEstimate(bundle);
  const refused = keyedEstimateFromEms(bundle, "29508501.zip");

  it("is neither the source's own nor a keyed side", () => {
    expect(isSourceOwnExport({ sheet: cccSheet, estimate }).yes).toBe(false);
    expect(refused.ok).toBe(false);
  });

  it("names the file and why it was not verified", () => {
    if (refused.ok) throw new Error("expected the gate to refuse this export");
    const explained = explainKeyedExport({ sheet: cccSheet, bundle, reason: refused.reason });
    expect(explained).toMatch(/a Mitchell workfile for the same VIN as the sheet, 93 lines/);
    expect(explained).toMatch(/The sheet above keys into CCC/);
    expect(explained).toMatch(/no sheet for that direction yet/);
    // Not the old instruction, which pointed at a comparison nobody asked for.
    expect(explained).not.toMatch(/Estimate Delta/);
  });

  it("keeps the gate's own words for an export of another vehicle", () => {
    if (refused.ok) throw new Error("expected the gate to refuse this export");
    const other = buildRekeySheet({
      text: fs.readFileSync(path.join(process.cwd(), "tests/fixtures/frk1b-mitchell-text.txt"), "utf8"),
      sourceFile: "other.pdf",
    });
    expect(explainKeyedExport({ sheet: other, bundle, reason: refused.reason })).toBe(refused.reason);
  });

  it("leaves the sheet alone", () => {
    expect(cccSheet.derivedTotals?.check).toMatchObject({ printedGrandTotal: 12138.16, delta: 0, closes: true });
  });
});
