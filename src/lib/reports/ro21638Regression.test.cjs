/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * RO21638-class regression fixture (SYNTHETIC — no customer data).
 *
 * Reproduces the parse/match failures audited on a shop-final vs
 * supplement-of-record pair that produced false findings:
 *  - qty-hours splits firing on non-qty rows ("22.0" became qty 2 + 2.0 hr)
 *    and NOT firing on glued Repl rows ("18Repl … 10.5" stayed 10.5 hr)
 *  - "-Per" descriptions wrapping their measurement to a digit-led line that
 *    was mis-read as a new row ("3 Ft" → phantom row L3 "Ft")
 *  - short ALL-CAPS wrapped option codes ("WSD") resetting the open row
 *  - dotted aftermarket catalog parts glued into the money run
 *    ("3012.0113" + 1 + 163.08 + 0.5 + 1.2)
 *  - LKQ runs where money glues to trailing hours ("…11,223.751.73.1")
 *  - glued part/qty/price preferring a runt part ("20733"+5+529.80 instead
 *    of "2073355"+2+9.80)
 *  - "Supplement of Record with Summary" recap sections (Changed/Deleted/
 *    Added items) re-parsed as rows — deleted items carry NEGATIVE hours
 *  - abbreviation-legend footer lines ("BLND=BLEND CAPA=…") parsed as rows
 *  - identical-description sibling rows with different part numbers
 *    cross-pairing into two false part-change findings
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveFilenameWithAlias(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    const absolute = path.join(process.cwd(), "src", request.slice(2));
    return originalResolveFilename.call(this, absolute, parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

require.extensions[".ts"] = function registerTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  module._compile(compiled.outputText, filename);
};

const {
  parseCccEstimateRow,
  parseCccEstimateRows,
  matchEstimateLineItems,
} = require("./estimateDeltaMatcher.ts");

let passed = 0;
let failed = 0;
function run(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(error && error.stack ? error.stack : error);
  }
}

// --- Numeric parsing -------------------------------------------------------

run("Rpr row hours never split into qty+hours (22.0 stays 22.0)", () => {
  const row = parseCccEstimateRow("101*S01RprRT Quarter panel68427794AC22.0");
  assert.equal(row.labor, 22.0);
  assert.equal(row.partNumber, "68427794AC");
});

run("glued Repl row qty-hours splits without a word boundary (18Repl … 10.5)", () => {
  const row = parseCccEstimateRow("18Repl Aim fog lamps10.5");
  assert.equal(row.qty, 1);
  assert.equal(row.labor, 0.5);
});

run("glued part/qty/price prefers the full-length part (valve stem)", () => {
  const row = parseCccEstimateRow("38Repl Valve stem207335529.80Incl.");
  assert.equal(row.partNumber, "2073355");
  assert.equal(row.qty, 2);
  assert.equal(row.price, 9.8);
  assert.equal(row.laborIncluded, true);
});

run("dotted A/M catalog part parses out of the glued money run", () => {
  const row = parseCccEstimateRow("21**S01ReplA/M RT Wheel flare3012.01131163.080.51.2");
  assert.equal(row.partNumber, "3012.0113");
  assert.equal(row.qty, 1);
  assert.equal(row.price, 163.08);
  assert.equal(row.labor, 0.5);
  assert.equal(row.paint, 1.2);
});

run("LKQ run with money glued to trailing hours parses fully", () => {
  const row = parseCccEstimateRow("66*S01ReplLKQ RT door assy +25%~41035906311,223.751.73.1");
  assert.equal(row.partNumber, "410359063");
  assert.equal(row.qty, 1);
  assert.equal(row.price, 1223.75);
  assert.equal(row.labor, 1.7);
  assert.equal(row.paint, 3.1);
});

run("alphanumeric part numbers with tiny digit tails do not split (C25J75-class)", () => {
  const row = parseCccEstimateRow("72Repl RT W'strip on body68498156AD166.500.6");
  assert.equal(row.partNumber, "68498156AD");
  assert.equal(row.price, 66.5);
  assert.equal(row.labor, 0.6);
});

run("unpriced glued diagnostic row keeps qty + marker (scan1m)", () => {
  const row = parseCccEstimateRow("146S01Pre-repair scan1m");
  assert.ok(row, "row must parse");
  assert.equal(row.qty, 1);
  assert.match(row.description, /scan/i);
});

// --- Wrapped rows ----------------------------------------------------------

run("'-Per' description wraps its measurement — no phantom row", () => {
  const rows = parseCccEstimateRows(
    ["44#Trim Masking Tape-3M 06347-Per", "3 Ft", "17.08T"].join("\n")
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].lineNumber, 44);
  assert.match(rows[0].description, /3 Ft/);
  assert.equal(rows[0].price, 7.08);
});

run("'-Per' wrap with qty 2 splits qty from price (214.16 → 2 × 14.16)", () => {
  const rows = parseCccEstimateRows(
    ["57#Trim Masking Tape-3M 06347-Per", "3 Ft", "214.16T"].join("\n")
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].qty, 2);
  assert.equal(rows[0].price, 14.16);
});

run("short ALL-CAPS option-code continuation does not reset the open row (WSD)", () => {
  const rows = parseCccEstimateRows(
    ['36*Repl RT/Front Wheel, alloy 22" code:', "WSD", "4755414AA11,695.00m0.3"].join("\n")
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].partNumber, "4755414AA");
  assert.equal(rows[0].price, 1695);
});

// --- Document structure ----------------------------------------------------

run("SUPPLEMENT SUMMARY recap (deleted items with negative hours) is not parsed", () => {
  const rows = parseCccEstimateRows(
    [
      "9S01R&IRT Wheel flare68565164AC0.5",
      "SUPPLEMENT SUMMARY",
      "Deleted Items",
      "43R&IRT Wheel flare68565166AD-0.5",
      "Added Items",
      "9S01R&IRT Wheel flare68565164AC0.5",
    ].join("\n")
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].lineNumber, 9);
  assert.equal(rows[0].labor, 0.5);
});

run("abbreviation-legend footer lines never become rows", () => {
  const rows = parseCccEstimateRows(
    [
      "BLND=BLEND CAPA=CERTIFIED AUTOMOTIVE PARTS ASSOCIATION  D&R=DISCONNECT AND RECONNECT",
      "Replace.  Rpr=Repair.  RT=Right.  SAS=Sandwiched Steel.  Sect=Section.  Subl=Sublet.",
    ].join("\n")
  );
  assert.equal(rows.length, 0);
});

// --- Matching --------------------------------------------------------------

run("identical-description siblings pair by part number — no false part changes", () => {
  const higherRows = parseCccEstimateRows(
    ["72Repl RT W'strip on body68498156AD166.500.6", "93Repl RT W'strip on body68498157AD168.950.6"].join(
      "\n"
    )
  );
  const lowerRows = parseCccEstimateRows(
    ["68S01ReplRT W'strip on body68498156AD166.500.6", "88S01ReplRT W'strip on body68498157AD168.950.6"].join(
      "\n"
    )
  );
  const result = matchEstimateLineItems({ lowerRows, higherRows, lowerIsOcr: false });
  const partChanges = result.deltas.filter((d) => /part .* -> /.test(d.summary ?? ""));
  assert.equal(partChanges.length, 0, "identical sibling rows must not report part changes");
  assert.equal(result.matchedPairCount, 2);
});

run("priced Repl pairs with the same-part row, not a description twin", () => {
  const higherRows = parseCccEstimateRows(
    ["76Repl RT Upper molding black68406314AE188.650.9", "120R&I  RT Upper molding black0.3"].join("\n")
  );
  const lowerRows = parseCccEstimateRows(
    ["73S01ReplRT Upper molding black68406314AE188.650.9", "112S01R&IRT Upper molding black6VF90DX8AB0.3"].join(
      "\n"
    )
  );
  const result = matchEstimateLineItems({ lowerRows, higherRows, lowerIsOcr: false });
  assert.equal(result.matchedPairCount, 2);
  const annotated = result.deltas.filter((d) => d.annotate);
  assert.equal(annotated.length, 0, `expected no findings, got: ${annotated.map((d) => d.summary).join(" | ")}`);
});

console.log(`\nro21638Regression: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
