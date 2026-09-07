import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildRekeySheet } from "../rekeyLedger";
import JSZip from "jszip";
import { classifyEmsSelection, normalizeEmsEstimate, readEmsBundle } from "../emsReader";
import { explainKeyedExport, keyedEstimateFromEms } from "../rekeyVerification";

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
