/* eslint-disable @typescript-eslint/no-require-imports */
// RO 22108 regression: the comparison (lower-cost) SOR-1 PDF extracted via
// pdf-parse as ONE TOKEN PER LINE. Line-based row grouping recovered only 26
// "rows" out of ~150 line items — half of them abbreviation-legend fragments
// ("RPR=REPAIR") — so nearly every line on the annotated shop estimate was
// falsely reported as missing/expanded scope, glossary text paired against
// real operations, and the totals lane silently vanished. These tests pin the
// fragmented-text reflow, legend rejection, wrapped-tail relocation,
// labor-category digit markers, and anchor section-bleed fixes.
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
  isFragmentedEstimateText,
  reflowFragmentedEstimateText,
  parseCccEstimateRow,
  parseCccEstimateRows,
  parseCccEstimateTotals,
  matchEstimateLineItems,
  isNonEstimateContentRow,
} = require("./estimateDeltaMatcher.ts");
const { buildEstimateRowAnchorsFromLines } = require("./citationDensityRowAnchors.ts");

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

// Representative slice of the real pdf-parse output shape: one token per
// line, glued line numbers ("11AIR"), page footer + repeated header chrome,
// fragmented ESTIMATE TOTALS block, and per-pair legend fragments.
const FRAGMENTED_SOR = [
  "Line", "Oper", "Description", "Part", "Number", "Qty", "Extended", "Price", "$", "Labor", "Paint",
  "1", "#", "Pleasesubmit", "supplement", "request", "1",
  "2", "#",
  "3", "FRONT", "BUMPER", "&", "GRILLE",
  "4", "R&IR&I", "bumper", "cover", "1.4",
  "5", "R&I", "LT", "Inner", "bracket", "0.2",
  "7", "FRONT", "LAMPS",
  "8", "R&I", "LT", "Headlamp", "assy", "0.4",
  "9", "Repl", "Aim", "headlamps", "1", "0.5",
  "11AIR", "CONDITIONER", "&", "HEATER",
  "12", "SOI", "Repl", "Filter", "HEPA", "filter", "165837500B", "1", "70.00",
  "7/21/2026", "8:07:43", "AM", "315137", "Page", "3",
  "Preliminary", "Supplement", "1", "with", "Summary", "Owner:", "sample,", "owner",
  "2022", "TESL", "Model", "YAWD",
  "37", "*", "SOI", "R&I", "RT", "Seat", "assy", "white", "from", "05/06/2021", "0.8",
  "39", "ROOF",
  "40", "Repl", "Glass", "panel", "Tesla", "150913100E", "1", "1,130.27", "6.5",
  "60", "R&I", "LT", "Window", "guide", "0.3",
  "75", "R&I", "Charging", "port", "m", "0.9", "M",
  "97", "LIFT", "GATE",
  "98", "SOI", "Repl", "Lift", "gate", "1493410E0A", "1", "1,599.56", "7.0", "3.5",
  "SUBTOTALS", "5,440.87", "56.6", "25.7",
  "ESTIMATETOTALS",
  "Category", "Basis", "Rate", "Cost", "$",
  "Parts", "4,643.57",
  "Body", "Labor", "50.9", "hrs", "@", "$", "90.00", "/hr", "4,581.00",
  "Paint", "Labor", "25.7", "hrs", "@", "$", "90.00", "/hr", "2,313.00",
  "MechanicalLabor", "4.7", "hrs", "@", "$", "175.00", "/hr", "822.50",
  "Paint", "Supplies", "25.7", "hrs", "@", "$", "48.00", "/hr", "1,233.60",
  "Subtotal", "14,480.97",
  "Total", "Cost", "of", "Repairs", "15,301.99",
  "7/21/2026", "8:07:43", "AM", "315137", "Page", "7",
  "SUPPLEMENTSUMMARY",
  "RPR=REPAIR",
  "Blnd=Blend.",
  "R&I=Remove",
  // Pad with more single-token lines so the fragmentation detector's minimum
  // line count is met (real documents have thousands).
  ...Array.from({ length: 40 }, (_, i) => `filler${i}`),
].join("\n");

run("fragmented one-token-per-line text is detected", () => {
  assert.equal(isFragmentedEstimateText(FRAGMENTED_SOR), true);
  // Normal spaced estimate text is NOT treated as fragmented.
  const spaced = Array.from({ length: 80 }, (_, i) => `${i + 1} R&I LT Sample part ${i} 0.4`).join("\n");
  assert.equal(isFragmentedEstimateText(spaced), false);
});

run("reflow rebuilds logical rows from the token stream", () => {
  const reflowed = reflowFragmentedEstimateText(FRAGMENTED_SOR);
  assert.match(reflowed, /4 R&IR&I bumper cover 1\.4/);
  assert.match(reflowed, /40 Repl Glass panel Tesla 150913100E 1 1,130\.27 6\.5/);
  assert.match(reflowed, /98 SOI Repl Lift gate 1493410E0A 1 1,599\.56 7\.0 3\.5/);
  // Page footer + repeated header chrome is dropped, not merged into a row.
  assert.doesNotMatch(reflowed, /Preliminary Supplement/);
  assert.doesNotMatch(reflowed, /315137/);
});

run("fragmented SOR rows parse with correct columns and sections", () => {
  const rows = parseCccEstimateRows(FRAGMENTED_SOR);
  const byLine = new Map(rows.map((row) => [row.lineNumber, row]));
  const bumper = byLine.get(4);
  assert.ok(bumper, "bumper cover row parses");
  assert.equal(bumper.labor, 1.4);
  assert.equal(bumper.section, "FRONT BUMPER & GRILLE");
  const glass = byLine.get(40);
  assert.ok(glass, "glass panel row parses");
  assert.equal(glass.price, 1130.27);
  assert.equal(glass.labor, 6.5);
  assert.equal(glass.partNumber, "150913100E");
  const liftGate = byLine.get(98);
  assert.ok(liftGate, "lift gate row parses");
  assert.equal(liftGate.price, 1599.56);
  assert.equal(liftGate.labor, 7);
  assert.equal(liftGate.paint, 3.5);
  // A date INSIDE a row ("from 05/06/2021") must not be mistaken for footer chrome.
  const seat = byLine.get(37);
  assert.ok(seat, "seat assy row with an interior date parses");
  assert.equal(seat.labor, 0.8);
});

run("abbreviation-legend fragments never become rows", () => {
  assert.equal(isNonEstimateContentRow("RPR=REPAIR"), true);
  assert.equal(isNonEstimateContentRow("Blnd=Blend."), true);
  assert.equal(isNonEstimateContentRow("R&I=Remove"), true);
  assert.equal(parseCccEstimateRow("RPR=REPAIR"), null);
  assert.equal(parseCccEstimateRow("Rpr=Repair."), null);
  const rows = parseCccEstimateRows(FRAGMENTED_SOR);
  assert.ok(
    rows.every((row) => !row.rawText.includes("=")),
    "no legend fragment parsed as a row"
  );
});

run("shared lines match across fragmented/spaced extractions (no false missing)", () => {
  const lowerRows = parseCccEstimateRows(FRAGMENTED_SOR);
  const higherRows = parseCccEstimateRows(
    [
      "8 R&I LT Headlamp assy 0.4",
      "12 * Repl Filter HEPA filter 165837500B 1 90.00",
      "61 Repl Glass panel Tesla 150913100E 1 1,130.27 6.5",
      "130 Repl Lift gate 1493410E0A 1 1,599.56 7.0 3.5",
    ].join("\n")
  );
  const match = matchEstimateLineItems({ lowerRows, higherRows, lowerCategoryText: FRAGMENTED_SOR });
  // Glass panel and lift gate are identical on both sides — never a delta.
  const flagged = match.deltas.filter((delta) =>
    /glass panel|lift gate/i.test(delta.higherRow.description) && delta.kind !== "part_or_price_difference"
  );
  assert.equal(flagged.length, 0, `no false findings for identical lines: ${JSON.stringify(flagged.map((d) => d.summary))}`);
  assert.ok(match.matchedPairCount >= 3, `matched ${match.matchedPairCount} pairs`);
});

run("fragmented ESTIMATE TOTALS parse recovers rates and hours", () => {
  const totals = parseCccEstimateTotals(FRAGMENTED_SOR);
  assert.ok(totals, "totals parsed");
  const byName = new Map(totals.categories.map((c) => [c.category.toLowerCase(), c]));
  assert.equal(byName.get("body labor")?.rate, 90);
  assert.equal(byName.get("body labor")?.hours, 50.9);
  assert.equal(byName.get("mechanical labor")?.rate, 175);
  assert.equal(byName.get("paint supplies")?.rate, 48);
  assert.equal(totals.grandTotal, 15301.99);
});

run("wrapped description tail after the hour column is relocated", () => {
  const row = parseCccEstimateRow("183 # Rpr Capture image to confirm 0.3 M adjustments were made correctly");
  assert.ok(row);
  assert.equal(row.labor, 0.3);
  assert.match(row.description, /adjustments were made correctly/);
  const glassRow = parseCccEstimateRow("84 R&I LT Door glass Tesla w/o 0.8 laminated");
  assert.ok(glassRow);
  assert.equal(glassRow.labor, 0.8);
});

run("user-defined labor-category digit between hours is a marker, not data", () => {
  // "1.0 1 2.0" = 1.0 body + category-1 (aluminum) 2.0 — same values as the
  // counterpart's "1.0 D 2.0"; both sides must parse identically.
  const shopRow = parseCccEstimateRow("26 * Rpr LT Fender primed 1.0 1 2.0");
  const sorRow = parseCccEstimateRow("19 * Rpr LT Fender primed 1.0 D 2.0");
  assert.ok(shopRow && sorRow);
  assert.equal(shopRow.labor, sorRow.labor);
  assert.equal(shopRow.paint, sorRow.paint);
  // A real qty before a single hour value is still a qty, not a marker.
  const qtyRow = parseCccEstimateRow("194 # Tint color 1 0.5");
  assert.ok(qtyRow);
  assert.equal(qtyRow.qty, 1);
  assert.equal(qtyRow.labor, 0.5);
});

run("glued/split compound words still match (Fenderliner vs Fender liner)", () => {
  const lower = parseCccEstimateRows("21 R&I RT Fenderliner 0.4\n22 R&I LT Fenderliner 0.4");
  const higher = parseCccEstimateRows("28 R&I RT Fender liner 0.4\n29 R&I LT Fender liner 0.4");
  const match = matchEstimateLineItems({ lowerRows: lower, higherRows: higher });
  assert.equal(match.matchedPairCount, 2);
  assert.equal(match.deltas.length, 0);
});

run("a wrapped lowercase 'calibration procedure' line does not become the running section", () => {
  const makeLine = (text, y) => ({
    pageNumber: 7,
    text,
    normalizedText: text.toLowerCase(),
    x: 40,
    y,
    width: 300,
    height: 10,
    pageWidth: 612,
    pageHeight: 792,
    words: [],
  });
  const anchors = buildEstimateRowAnchorsFromLines(
    [
      makeLine("176 VEHICLE DIAGNOSTICS", 100),
      makeLine("181 # Rpr Set up & initiate camera 1.0 M", 112),
      makeLine("calibration procedure", 124),
      makeLine("189 MISCELLANEOUS OPERATIONS", 136),
      makeLine("190 # Pre wash vehicle 1 5.00 T 0.5", 148),
    ],
    { sourceDocumentRole: "source_estimate" }
  );
  const preWash = anchors.find((anchor) => /pre wash/i.test(anchor.description || anchor.text || ""));
  assert.ok(preWash, "pre wash anchor exists");
  assert.notEqual(preWash.section, "calibration");
  assert.doesNotMatch(preWash.section ?? "", /calibration/i);
});

run("glued section headers with line numbers are still detected (189MISCELLANEOUS OPERATIONS)", () => {
  const makeLine = (text, y) => ({
    pageNumber: 7,
    text,
    normalizedText: text.toLowerCase(),
    x: 40,
    y,
    width: 300,
    height: 10,
    pageWidth: 612,
    pageHeight: 792,
    words: [],
  });
  const anchors = buildEstimateRowAnchorsFromLines(
    [
      makeLine("189MISCELLANEOUS OPERATIONS", 100),
      makeLine("190 # Pre wash vehicle 1 5.00 T 0.5", 112),
    ],
    { sourceDocumentRole: "source_estimate" }
  );
  const preWash = anchors.find((anchor) => /pre wash/i.test(anchor.description || anchor.text || ""));
  assert.ok(preWash, "pre wash anchor exists");
  assert.match(preWash.section ?? "", /miscellaneous operations/i);
});

console.log(`\nro22108Regression: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
