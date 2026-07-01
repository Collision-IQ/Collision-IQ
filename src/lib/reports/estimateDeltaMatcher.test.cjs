/* eslint-disable @typescript-eslint/no-require-imports */
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
  parseEstimateNetTotal,
  isSectionHeader,
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

// --- Single-row parsing (real CCC supplement rows) -------------------------

run("parses a part row with part number, qty, price, labor, paint", () => {
  const row = parseCccEstimateRow("40 * S02 Repl RCY lift gate +25% C25J75 1 1,575.00 5.4 3.7");
  assert.equal(row.lineNumber, 40);
  assert.equal(row.opCode, "Repl");
  assert.equal(row.partNumber, "C25J75");
  assert.equal(row.qty, 1);
  assert.equal(row.price, 1575);
  assert.equal(row.labor, 5.4);
  assert.equal(row.paint, 3.7);
  assert.match(row.description, /lift gate/i);
});

run("parses an Incl. labor cell as included (null labor)", () => {
  const row = parseCccEstimateRow("55 ** Repl A/M Molding black ice chrome GM1144143 1 147.00 Incl. 0.0");
  assert.equal(row.partNumber, "GM1144143");
  assert.equal(row.price, 147);
  assert.equal(row.labor, null);
  assert.equal(row.laborIncluded, true);
  assert.equal(row.paint, 0);
});

run("parses labor with a mechanical marker between price and labor", () => {
  const row = parseCccEstimateRow("3 S02 R&I R&I steering column 0 0.00 m 1.2 0.0");
  assert.equal(row.opCode, "R&I");
  assert.equal(row.labor, 1.2);
  assert.equal(row.paint, 0);
  assert.match(row.description, /steering column/i);
});

run("parses a sublet row with taxed markers", () => {
  const row = parseCccEstimateRow("72 * S01 Subl Pre-repair scan +25% 1 187.50 T m 0.0 0.0");
  assert.equal(row.opCode, "Subl");
  assert.equal(row.price, 187.5);
  assert.equal(row.labor, 0);
  assert.equal(row.paint, 0);
});

run("rejects section headers and boilerplate", () => {
  assert.equal(isSectionHeader("REAR BUMPER"), true);
  assert.equal(isSectionHeader("VEHICLE DIAGNOSTICS"), true);
  assert.equal(isSectionHeader("19 QUARTER PANEL"), true);
  assert.equal(parseCccEstimateRow("REAR BUMPER"), null);
  assert.equal(
    parseCccEstimateRow(
      "FIT AND CORROSION RESISTANCE OF ANY AFTERMARKET/COMPETITIVE OUTER BODY CRASH PARTS THAT ARE"
    ),
    null
  );
  assert.equal(
    parseCccEstimateRow("(Alternative OEM) parts are OEM parts that may be provided by or through alternate sources other than the OEM"),
    null
  );
});

run("parses net cost of repairs total", () => {
  assert.equal(parseEstimateNetTotal("Net Cost of Repairs 7,563.71"), 7563.71);
  assert.equal(parseEstimateNetTotal("NET COST OF REPAIRS: $ 6,844.48"), 6844.48);
  assert.equal(parseEstimateNetTotal("no totals here"), null);
});

// --- Structured matching across two real supplements -----------------------

const LOWER_SOR1 = [
  "STEERING COLUMN",
  "3 S01 R&I R&I steering column 0 0.00 m 1.2 0.0",
  "WINDSHIELD",
  "10 * S01 Rpr Windshield GMC w/o video display 0 0.00 0.6 0.0",
  "ROOF",
  "18 * S01 R&I R&I headliner 0 0.00 2.0 0.0",
  "LIFT GATE",
  "39 * S01 Repl RCY Lift gate +25% C25J75 1 1,575.00 5.4 3.7",
  "REAR BUMPER",
  "53 ** Repl A/M Molding black ice chrome GM1144143 1 147.00 Incl. 0.0",
  "VEHICLE DIAGNOSTICS",
  "66 * Rpr Post-repair scan 0 0.00 m 0.5 0.0",
  "MISCELLANEOUS OPERATIONS",
  "77 # S01 Rpr Color Sand and Buff 0 0.00 0.5 0.0",
  "Net Cost of Repairs 6,844.48",
].join("\n");

const HIGHER_SOR2 = [
  "STEERING COLUMN",
  "3 S02 R&I R&I steering column 0 0.00 m 1.2 0.0",
  "WINDSHIELD",
  "10 * S02 Rpr Windshield GMC w/o video display 0 0.00 1.0 0.0",
  "ROOF",
  "18 * S02 R&I R&I headliner 0 0.00 3.0 0.0",
  "LIFT GATE",
  "40 * S02 Repl RCY lift gate +25% C25J75 1 1,575.00 5.4 3.7",
  "REAR BUMPER",
  "55 ** Repl A/M Molding black ice chrome GM1144143 1 147.00 Incl. 0.0",
  "VEHICLE DIAGNOSTICS",
  "75 * S02 Rpr Post-repair scan 0 0.00 m 0.5 M 0.0",
  "MISCELLANEOUS OPERATIONS",
  "82 # S01 Rpr Color Sand and Buff 0 0.00 0.5 0.0",
  "85 # S02 Rpr Denib and Polish 0 0.00 2.0 0.0",
  "86 # S02 Rpr Color Tint 0 0.00 0.0 0.5",
  "Net Cost of Repairs 7,563.71",
].join("\n");

run("matches lift gate and molding by part number with no false delta", () => {
  const lowerRows = parseCccEstimateRows(LOWER_SOR1);
  const higherRows = parseCccEstimateRows(HIGHER_SOR2);
  const result = matchEstimateLineItems({ lowerRows, higherRows });

  const liftGate = result.deltas.find((delta) => /lift gate/i.test(delta.summary));
  assert.equal(liftGate, undefined, "lift gate should match by part C25J75 with no delta");
  const molding = result.deltas.find((delta) => /molding/i.test(delta.summary));
  assert.equal(molding, undefined, "molding should match by part GM1144143 with no delta");
});

run("flags windshield and headliner reduced labor with correct deltas", () => {
  const lowerRows = parseCccEstimateRows(LOWER_SOR1);
  const higherRows = parseCccEstimateRows(HIGHER_SOR2);
  const result = matchEstimateLineItems({ lowerRows, higherRows });

  const windshield = result.deltas.find((delta) => /windshield/i.test(delta.summary));
  assert.ok(windshield, "windshield labor reduction should be flagged");
  assert.equal(windshield.kind, "reduced_labor");
  assert.equal(windshield.laborDelta, 0.4);

  const headliner = result.deltas.find((delta) => /headliner/i.test(delta.summary));
  assert.ok(headliner, "headliner labor reduction should be flagged");
  assert.equal(headliner.kind, "reduced_labor");
  assert.equal(headliner.laborDelta, 1);
});

run("flags denib/polish and color tint as missing operations", () => {
  const lowerRows = parseCccEstimateRows(LOWER_SOR1);
  const higherRows = parseCccEstimateRows(HIGHER_SOR2);
  const result = matchEstimateLineItems({ lowerRows, higherRows });

  const denib = result.deltas.find((delta) => /denib/i.test(delta.summary));
  assert.ok(denib, "denib and polish should be a missing operation");
  assert.equal(denib.kind, "missing_operation");

  const colorTint = result.deltas.find((delta) => /color tint/i.test(delta.summary));
  assert.ok(colorTint, "color tint should be a missing operation");
  assert.equal(colorTint.kind, "missing_operation");
});

run("does not flag steering column, post-repair scan, or color sand (unchanged)", () => {
  const lowerRows = parseCccEstimateRows(LOWER_SOR1);
  const higherRows = parseCccEstimateRows(HIGHER_SOR2);
  const result = matchEstimateLineItems({ lowerRows, higherRows });

  assert.equal(result.deltas.some((delta) => /steering column/i.test(delta.summary)), false);
  assert.equal(result.deltas.some((delta) => /post-repair scan/i.test(delta.summary)), false);
  assert.equal(result.deltas.some((delta) => /color sand/i.test(delta.summary)), false);
});

run("produces no deltas when the two estimates are identical", () => {
  const rows = parseCccEstimateRows(HIGHER_SOR2);
  const result = matchEstimateLineItems({ lowerRows: rows, higherRows: rows });
  assert.equal(result.deltas.length, 0);
});

run("produces no deltas when there is no comparison estimate", () => {
  const lowerRows = parseCccEstimateRows(LOWER_SOR1);
  const result = matchEstimateLineItems({ lowerRows, higherRows: [] });
  assert.equal(result.deltas.length, 0);
});

// --- Concatenated CCC prefixes (RO22006) -----------------------------------

run("parses a concatenated CCC prefix (line*S01Op) without leaking markers", () => {
  const row = parseCccEstimateRow("13*S01RprWindshield Honda EX 1 250.00 0.5");
  assert.equal(row.lineNumber, 13);
  // The S01 labor code and * symbol must not survive into the description.
  assert.doesNotMatch(row.description, /s01/i);
  assert.doesNotMatch(row.description, /\*/);
  assert.match(row.description, /windshield/i);
});

run("does not mark a shared operation missing when only the CCC prefix/markup differs", () => {
  // Shop writes "*Rpr", carrier writes "*S01Rpr" + markup for the same op.
  const shop = "14*RprWindshield Honda EX 1 250.00 0.5";
  const carrier = "13*S01RprWindshield Honda EX +25% 1 250.00 0.5";
  const shopRows = parseCccEstimateRows(shop);
  const carrierRows = parseCccEstimateRows(carrier);
  const result = matchEstimateLineItems({ lowerRows: carrierRows, higherRows: shopRows });
  const windshieldMissing = result.deltas.find(
    (delta) => /windshield/i.test(delta.summary) && delta.kind === "missing_operation"
  );
  assert.equal(
    windshieldMissing,
    undefined,
    "windshield present in both estimates must not be reported as a missing operation"
  );
});

run("treats an OEM-vs-A/M part swap as a part difference, not a missing op (#5)", () => {
  // Shop OEM part vs carrier aftermarket part for the same operation.
  const shop = "45 Repl LT Side support 71598TBGA00 1 29.83 0.5";
  const carrier = "42*S01Repl LT Side support 553756G 1 22.25 0.5";
  const shopRows = parseCccEstimateRows(shop);
  const carrierRows = parseCccEstimateRows(carrier);
  const result = matchEstimateLineItems({ lowerRows: carrierRows, higherRows: shopRows });
  const sideSupport = result.deltas.find((delta) => /side support/i.test(delta.summary));
  if (sideSupport) {
    assert.notEqual(
      sideSupport.kind,
      "missing_operation",
      "an OEM-vs-A/M part swap must not be reported as a missing operation"
    );
  }
});

console.log(`\nestimateDeltaMatcher: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
