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
const {
  buildAnnotatedCitationDensityEstimatePdf,
  buildRequiredEstimatorDeltaFindings,
} = require("./annotatedCitationDensityEstimate.ts");

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

run("a wrapped part-dimension tail never becomes phantom hour columns", () => {
  // Shop anchor rejoins the wrapped dimension AFTER the columns; the "x"
  // must not read as a taxed marker nor the digits as qty/hours (this
  // produced a false "+1.0 paint hr" finding on a $5 grommet).
  const shop = parseCccEstimateRow("157 Repl RT Backup lamp grommet 110492600B 1 5.00 Incl. 8.2x12.2");
  assert.ok(shop);
  assert.equal(shop.paint, null);
  assert.equal(shop.labor, null);
  assert.equal(shop.laborIncluded, true);
  assert.equal(shop.price, 5);
  assert.equal(shop.partNumber, "110492600B");
  const sor = parseCccEstimateRow("117 Repl RT Backuplamp grommet 8.2x12.2 110492600B 1 5.00 Ind.");
  assert.ok(sor);
  const match = matchEstimateLineItems({ lowerRows: [sor], higherRows: [shop] });
  assert.equal(match.matchedPairCount, 1);
  assert.equal(match.deltas.length, 0, JSON.stringify(match.deltas.map((d) => d.summary)));
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

// --- Manual-annotation parity fixes (RO 22108 round 2) ----------------------
// The user's hand-annotated shop estimate + SOR exposed seven defect classes:
// SOI marker leakage, glued dimension+part runs, RT/LT part-number cross-
// pairing, OCR-garbled twins, consolidated misc lines, note-tail merged rows,
// and value-blind pairing of repeated generic rows.

run("OCR'd S01 marker (SOI) is stripped from descriptions", () => {
  const row = parseCccEstimateRow("139 # SOI Masking Tape 1 14.16");
  assert.ok(row);
  assert.equal(row.description, "Masking Tape");
  assert.equal(row.price, 14.16);
  const opRow = parseCccEstimateRow("33 * SOI Rpr WindshieldTesla w/o TSA3 0.5");
  assert.ok(opRow);
  assert.equal(opRow.opCode, "Rpr");
  // ALL-CAPS words starting with S-O/L must never lose their head.
  const solid = parseCccEstimateRow("199 # Solid waste removal 1 5.00 T");
  assert.ok(solid);
  assert.match(solid.description, /^Solid waste removal/);
});

run("a dimension glued to the part number still yields the part (8.2x12.2110492600B)", () => {
  const row = parseCccEstimateRow("111 Repl LT Tail lamp grommet 8.2x12.2110492600B 1 5.00 Ind.");
  assert.ok(row);
  assert.equal(row.partNumber, "110492600B");
  assert.equal(row.price, 5);
  const dashDim = parseCccEstimateRow("113 Repl LT Tail lamp grommet 8.0x5-0.9110433500B 1 5.00 Ind.");
  assert.ok(dashDim);
  assert.equal(dashDim.partNumber, "110433500B");
});

run("same-part RT/LT twins never cross-pair; the truly-missing gasket is flagged", () => {
  const higherRows = parseCccEstimateRows([
    "146 REAR LAMPS",
    "149 Repl RT Tail lamp grommet 8.2x12.2 110492600B 1 5.00 Incl.",
    "150 Repl LT Tail lamp grommet 8.2x12.2 110492600B 1 5.00 Incl.",
    "153 Repl RT Tail lamp gasket 145338100A 1 9.00 Incl.",
    "154 Repl LT Tail lamp gasket 145338100A 1 9.00 Incl.",
    "157 Repl RT Backup lamp grommet 110492600B 1 5.00 Incl. 8.2x12.2",
    "158 Repl LT Backup lamp grommet 110492600B 1 5.00 Incl. 8.2x12.2",
  ].join("\n"));
  const lowerRows = parseCccEstimateRows([
    "107 REAR LAMPS",
    "110 Repl RTTail lamp grommet 8.2x12.2110492600B 1 5.00 Ind.",
    "111 Repl LT Tail lamp grommet 8.2x12.2110492600B 1 5.00 Ind.",
    "114 Repl LT Tail lamp gasket 145338100A 1 9.00 Ind.",
    "117 Repl RT Backuplamp grommet 8.2x12.2 110492600B 1 5.00 Ind.",
    "118 Repl LT Backuplamp grommet 8.2x12.2 110492600B 1 5.00 Ind.",
  ].join("\n"));
  const match = matchEstimateLineItems({ lowerRows, higherRows });
  assert.equal(match.matchedPairCount, 5, JSON.stringify(match.deltas.map((d) => d.summary)));
  assert.equal(match.deltas.length, 1, JSON.stringify(match.deltas.map((d) => d.summary)));
  assert.match(match.deltas[0].higherRow.description, /RT Tail lamp gasket/i);
  assert.equal(match.deltas[0].lowerRow, null);
});

run("R&I Backup lamp matches its OCR-glued 'Backuplamp Ind.' twin", () => {
  const higherRows = parseCccEstimateRows("155 R&I RT Backup lamp Incl.\n156 R&I LT Backup lamp Incl.");
  const lowerRows = parseCccEstimateRows("115 R&I RT Backuplamp Ind.\n116 R&I LT Backuplamp Ind.");
  const match = matchEstimateLineItems({ lowerRows, higherRows });
  assert.equal(match.matchedPairCount, 2);
  assert.equal(match.deltas.length, 0, JSON.stringify(match.deltas.map((d) => d.summary)));
});

run("OCR-garbled token twins still pair (Upper/Lipper, voltage/violate)", () => {
  const bracket = matchEstimateLineItems({
    lowerRows: parseCccEstimateRows("6 R&I LT Lipper bracket 0.2"),
    higherRows: parseCccEstimateRows("9 R&I LT Upper bracket 0.2"),
  });
  assert.equal(bracket.matchedPairCount, 1);
  assert.equal(bracket.deltas.length, 0, JSON.stringify(bracket.deltas.map((d) => d.summary)));

  const hv = matchEstimateLineItems({
    lowerRows: parseCccEstimateRows("153 # SOI isolate high violate 1 0.5 M"),
    higherRows: parseCccEstimateRows("37 # Isolate high voltage 1 1.0 M"),
  });
  assert.equal(hv.matchedPairCount, 1, JSON.stringify(hv.deltas.map((d) => d.summary)));
  assert.equal(hv.deltas.length, 1);
  assert.equal(hv.deltas[0].kind, "reduced_labor");
  assert.equal(hv.deltas[0].laborDelta, 0.5);
});

run("consolidated misc twins pair by shared content words (Mask jambs ~ Mask Openings/Jambs)", () => {
  const match = matchEstimateLineItems({
    lowerRows: parseCccEstimateRows("147 # SOI Mask Openings/Jambs 1 21.00 1.2"),
    higherRows: parseCccEstimateRows("193 # Mask jambs (0.3 Hours and $3.00 7 21.00 T 2.1 per panel)"),
  });
  assert.equal(match.matchedPairCount, 1, JSON.stringify(match.deltas.map((d) => d.summary)));
  assert.equal(match.deltas.length, 1);
  assert.equal(match.deltas[0].kind, "reduced_labor");
  assert.equal(match.deltas[0].laborDelta, 0.9);
});

run("a unique-amount misc/sublet pair matches by price+hours (Paid out ~ Towing)", () => {
  const paired = matchEstimateLineItems({
    lowerRows: parseCccEstimateRows("152 # Towing 1 797.30 X"),
    higherRows: parseCccEstimateRows("1 # Subl Paid out 1 797.30 X"),
  });
  assert.equal(paired.matchedPairCount, 1, JSON.stringify(paired.deltas.map((d) => d.summary)));
  assert.equal(paired.deltas.length, 0);

  // Same price but different hours is NOT the same pay item.
  const rejected = matchEstimateLineItems({
    lowerRows: parseCccEstimateRows("134 # SOI Repl Cover car/bag 1 10.00 0.3"),
    higherRows: parseCccEstimateRows("192 # Mask for refinishing 1 10.00 T 0.5"),
  });
  assert.equal(rejected.matchedPairCount, 0);
  assert.equal(rejected.deltas.length, 1);
  assert.equal(rejected.deltas[0].lowerRow, null);
});

run("a merged note tail or wrapped '(… per panel)' tail still parses columns", () => {
  const testFit = parseCccEstimateRow(
    "175 # Test fit-Rear bumper 1 1.0 1 avoid damage to newly painted components (2 techs)"
  );
  assert.ok(testFit, "note-tail-merged row parses");
  assert.equal(testFit.lineNumber, 175);
  assert.match(testFit.description, /Test fit-Rear bumper/);

  const sandPolish = parseCccEstimateRow("195 # Finish sand & polish (0.5 Refinish 8 3.0 per panel)");
  assert.ok(sandPolish, "wrapped per-panel row parses");
  assert.equal(sandPolish.qty, 8);
  assert.equal(sandPolish.labor, 3);
});

run("repeated generic rows pair by matching hours, not document order (Add for Clear Coat)", () => {
  const higherRows = parseCccEstimateRows([
    "25 FENDER",
    "27 Add for Clear Coat 0.8",
    "56 ROOF",
    "58 Add for Clear Coat 0.4",
    "60 Add for Clear Coat 0.4",
    "129 LIFT GATE",
    "132 Add for Clear Coat 0.7",
    "164 REAR BUMPER",
    "167 Add for Clear Coat 1.1",
  ].join("\n"));
  const lowerRows = parseCccEstimateRows([
    "18 FENDER",
    "20 Add for Clear Coat 0.8",
    "97 LIFT GATE",
    "100 SOI Add for Clear Coat 0.7",
    "123 REAR BUMPER",
    "125 Add for Clear Coat 1.1",
  ].join("\n"));
  const match = matchEstimateLineItems({ lowerRows, higherRows });
  assert.equal(match.matchedPairCount, 3, JSON.stringify(match.deltas.map((d) => d.summary)));
  // Only the two 0.4-hr roof rows are unmatched; matched pairs carry no delta.
  const unmatched = match.deltas.filter((delta) => delta.lowerRow === null);
  assert.equal(unmatched.length, 2, JSON.stringify(match.deltas.map((d) => d.summary)));
  assert.ok(unmatched.every((delta) => delta.higherRow.labor === 0.4));
  assert.equal(match.deltas.length, 2, JSON.stringify(match.deltas.map((d) => d.summary)));
});

// --- Manual-annotation parity fixes (RO 22108 round 3) ----------------------
// The 69-finding build still carried five defect classes: operation rows with
// guide-ish words ("Window guide", "DUAL MOTOR") dropped as guide_row anchors,
// cross-section pairing of repeated Overlap rows, synonym wording treated as
// missing ops (Color Sand/Buff), M-marked mechanical hours described as body
// labor, and itemized materials reported as missing when the SOR bundles them.

run("operation rows containing guide-ish words still anchor as estimate lines", () => {
  const makeLine = (text, y) => ({
    pageNumber: 5,
    text,
    normalizedText: text.toLowerCase(),
    x: 33,
    y,
    width: 300,
    height: 8,
    pageWidth: 612,
    pageHeight: 792,
    words: [],
  });
  const anchors = buildEstimateRowAnchorsFromLines(
    [
      makeLine("85 R&I LT Window guide 0.3", 100),
      makeLine('135 Repl Nameplate "DUAL MOTOR" w/o 148484800A 1 36.00 0.2', 112),
      makeLine("Estimate based on MOTOR CRASH ESTIMATING GUIDE and CCC MOTOR database guide pages.", 124),
    ],
    { sourceDocumentRole: "source_estimate" }
  );
  const windowGuide = anchors.find((anchor) => /window guide/i.test(anchor.rowText));
  assert.equal(windowGuide?.anchorType, "estimate_line", "Window guide row is an estimate line");
  const nameplate = anchors.find((anchor) => /dual motor/i.test(anchor.rowText));
  assert.equal(nameplate?.anchorType, "estimate_line", "DUAL MOTOR nameplate row is an estimate line");
  const boilerplate = anchors.find((anchor) => /estimating guide/i.test(anchor.rowText));
  assert.equal(boilerplate?.anchorType ?? "guide_row", "guide_row", "guide boilerplate stays a guide row");
});

run("Color Sand/Buff pairs with Finish sand & polish (synonym fold)", () => {
  const match = matchEstimateLineItems({
    lowerRows: parseCccEstimateRows("149 Color Sand/Buff 1 3.0"),
    higherRows: parseCccEstimateRows("195 # Finish sand & polish (0.5 Refinish 8 3.0 per panel)"),
  });
  assert.equal(match.matchedPairCount, 1, JSON.stringify(match.deltas.map((d) => d.summary)));
  assert.equal(match.lowerOnlyRows.length, 0);
  assert.ok(!match.deltas.some((d) => d.kind === "missing_operation" || d.kind === "expanded_scope"));
});

run("repeated Overlap rows pair within their own section", () => {
  // Shop has ONE overlap (LIFT GATE); SOR has two (ROOF + LIFT GATE). The
  // LIFT GATE pair must match, leaving the ROOF overlap as the lower-only row.
  const higherRows = parseCccEstimateRows(["129 LIFT GATE", "131 Overlap Major Non-Adj. Panel -0.2"].join("\n"));
  const lowerRows = parseCccEstimateRows(
    ["39 ROOF", "52 Overlap Major Non-Adj. Panel -0.2", "97 LIFT GATE", "99 Overlap Major Non-Adj. Panel -0.2"].join("\n")
  );
  const match = matchEstimateLineItems({ lowerRows, higherRows });
  assert.equal(match.matchedPairCount, 1);
  // Round 4: the residual ROOF overlap duplicates the matched LIFT GATE
  // overlap's description, so it reports as a possible duplicate, never as
  // confirmed lower-only scope.
  assert.equal(match.lowerOnlyRows.length, 0);
  assert.equal(match.potentialDuplicateLowerRows.length, 1);
  assert.equal(match.potentialDuplicateLowerRows[0].section, "ROOF", "the ROOF overlap is the duplicate");
});

run("labor-type column letter is captured and drives the summary noun", () => {
  const noPrice = parseCccEstimateRow("153 # SOI isolate high violate 1 0.5 M");
  assert.ok(noPrice);
  assert.equal(noPrice.laborType, "M");
  const withPrice = parseCccEstimateRow("190 # Pre wash vehicle 1 5.00 T 0.5");
  assert.ok(withPrice);
  assert.equal(withPrice.laborType ?? null, null, "taxed-charge T is never a labor type");

  const hv = matchEstimateLineItems({
    lowerRows: parseCccEstimateRows("153 # SOI isolate high violate 1 0.5 M"),
    higherRows: parseCccEstimateRows("37 # Isolate high voltage 1 1.0 M"),
  });
  assert.equal(hv.deltas.length, 1);
  assert.match(hv.deltas[0].summary, /mechanical labor/);
  assert.doesNotMatch(hv.deltas[0].summary, /body labor/);
});

run("itemized glass materials vs a bundled Glass Kit read as invoice-dependent, not missing", () => {
  const higherRows = parseCccEstimateRows(
    [
      "108 WINDSHIELD",
      "111 # BetaSeal Express Urethane 1 37.00 T",
      "112 # BetaPrime 5504G All-in-One 2 18.32 T",
      "113 # Threaded Cartridge Nozzle-3M 2 6.22 T",
      "139 # Mask for primer 1 5.00 T 0.3",
    ].join("\n")
  );
  const lowerText = [
    "100 WINDSHIELD",
    "141 Glass Kit 3 75.00",
    "142 Primer (invoicerequired) 1",
    "143 Nozzles(invoicereuired) 1",
  ].join("\n");
  const match = matchEstimateLineItems({
    lowerRows: parseCccEstimateRows(lowerText),
    higherRows,
    lowerCategoryText: lowerText,
  });
  const bundled = match.deltas.filter((d) => d.bundledEquivalentCandidate);
  const bundledDescriptions = bundled.map((d) => d.higherRow.description.toLowerCase());
  assert.ok(bundledDescriptions.some((d) => d.includes("betaseal")), "urethane is bundled-flagged");
  assert.ok(bundledDescriptions.some((d) => d.includes("betaprime")), "primer is bundled-flagged");
  assert.ok(
    bundled.every((d) => (d.statusLabels ?? []).includes("POSSIBLE_BUNDLED_EQUIVALENT")),
    "bundled candidates carry the status label"
  );
  assert.ok(
    bundled.every((d) => /bundled|invoice/i.test(d.summary) && !/not present on the lower estimate/i.test(d.summary)),
    "bundled candidates never claim the line is absent"
  );
  // Masking OPERATIONS are never bundled-material candidates.
  const maskDelta = match.deltas.find((d) => /mask for primer/i.test(d.higherRow.description));
  assert.ok(maskDelta, "mask for primer still reports");
  assert.ok(!maskDelta.bundledEquivalentCandidate, "mask for primer is an operation, not a material");
});

run("clear-coat hours read as refinish, not body labor, in unmatched summaries", () => {
  const match = matchEstimateLineItems({
    lowerRows: parseCccEstimateRows("39 ROOF\n42 Rpr LT Roof rail 1.0 1.6"),
    higherRows: parseCccEstimateRows("56 ROOF\n58 Add for Clear Coat 0.4"),
    lowerCategoryText: "ROOF",
  });
  assert.equal(match.deltas.length, 1);
  assert.match(match.deltas[0].summary, /0\.4 refinish hr/);
  assert.doesNotMatch(match.deltas[0].summary, /body labor/);
});

// --- Manual-annotation parity fixes (RO 22108 round 4) ----------------------
// Remaining matcher defects: reconciled lower rows leaking into lower-only,
// repeated-section duplicates, protection-scope wording pairs, parent/child
// clear-coat double counting, and coding-only operation changes overstated.

run("reconciled lower rows are never lower-only; residual twins classify as duplicates", () => {
  const higherRows = parseCccEstimateRows([
    "1 ROOF",
    "2 R&I LT Rocker molding type 1 1.0",
    "5 LIFT GATE",
    "6 Repl Lift gate 1493410E0A 1 1,599.56 7.0 3.5",
    "7 Overlap Major Non-Adj. Panel -0.2",
    "10 REAR BODY & FLOOR",
    "11 R&I Storage compart 1.2",
    "12 Repl Storage compart 149294500C 1 74.00 0.3",
    "20 WINDSHIELD",
    "21 # BetaSeal Express Urethane 1 37.00 T",
    "30 MISCELLANEOUS OPERATIONS",
    "31 # Interior Protection kit 1 3.22 0.1",
  ].join("\n"));
  const lowerText = [
    "1 ROOF",
    "2 R&I RT Rocker molding type 1 1.0",
    "3 R&I LT Rocker molding type 1 1.0",
    "4 Overlap Major Non-Adj. Panel -0.2",
    "5 LIFT GATE",
    "6 SOI Repl Lift gate 1493410E0A 1 1,599.56 7.0 3.5",
    "7 Overlap Major Non-Adj. Panel -0.2",
    "10 REAR BODY & FLOOR",
    "11 R&I Storage compart 1.2",
    "12 R&I Storage compart 0.3",
    "13 SOI Repl Storage compart 149294500C 1 74.00 0.3",
    "30 MISCELLANEOUSOPERATIONS",
    "31 COVERINTERIOR 1 3.22 0.1",
    "32 SOI Repl Cover car/bag 1 10.00 0.3",
    "33 Glass Kit 3 75.00",
  ].join("\n");
  const match = matchEstimateLineItems({
    lowerRows: parseCccEstimateRows(lowerText),
    higherRows,
    lowerCategoryText: lowerText,
  });
  const lowerOnlyDescriptions = match.lowerOnlyRows.map((row) => row.description);
  assert.ok(
    !lowerOnlyDescriptions.some((d) => /Overlap|Storage compart|Cover car\/bag|Glass Kit/i.test(d)),
    `reconciled rows leaked into lower-only: ${JSON.stringify(lowerOnlyDescriptions)}`
  );
  // The RT rocker molding is genuinely lower-only (shop only bills LT).
  assert.ok(
    lowerOnlyDescriptions.some((d) => /RT Rocker molding/i.test(d)),
    JSON.stringify(lowerOnlyDescriptions)
  );
  const duplicateDescriptions = match.potentialDuplicateLowerRows.map((row) => row.description);
  assert.ok(duplicateDescriptions.some((d) => /Major Non-Adj/i.test(d)), "extra Overlap is a duplicate");
  assert.ok(duplicateDescriptions.some((d) => /Storage compart/i.test(d)), "residual R&I storage is a duplicate");
  assert.ok(duplicateDescriptions.some((d) => /Cover car\/bag/i.test(d)), "second protection line is a duplicate");
  // The Glass Kit was consumed as the bundle counterpart for BetaSeal.
  const glassKit = match.lowerRowReconciliation.find((entry) => /Glass Kit/i.test(entry.description));
  assert.ok(glassKit, "glass kit reconciliation recorded");
  assert.equal(glassKit.matchedAs, "bundle");
});

run("protection alias pairs as a changed line when no exact counterpart exists", () => {
  const match = matchEstimateLineItems({
    lowerRows: parseCccEstimateRows("134 SOI Repl Cover car/bag 1 10.00 0.3"),
    higherRows: parseCccEstimateRows("191 # Interior Protection kit 1 3.22 0.1"),
  });
  assert.equal(match.matchedPairCount, 1);
  assert.equal(match.lowerOnlyRows.length, 0);
  assert.equal(match.deltas.length, 1);
  const delta = match.deltas[0];
  assert.equal(delta.kind, "operation_change");
  assert.match(delta.summary, /Interior Protection kit/i);
  assert.match(delta.summary, /Cover car\/bag/i);
  assert.ok((delta.changedFields ?? []).includes("description"));
  assert.ok((delta.changedFields ?? []).includes("price"));
  assert.ok((delta.changedFields ?? []).includes("labor"));
});

run("clear-coat child folds into the parent refinish delta when hours reconcile exactly", () => {
  const match = matchEstimateLineItems({
    lowerRows: parseCccEstimateRows(["39 ROOF", "42 Rpr RT Roof rail 1.0 1.6", "44 Rpr LT Roof rail 1.0 1.6"].join("\n")),
    higherRows: parseCccEstimateRows([
      "56 ROOF",
      "57 Rpr RT Roof rail 1.0 2.0",
      "58 Add for Clear Coat 0.4",
      "59 Rpr LT Roof rail 1.0 2.0",
      "60 Add for Clear Coat 0.4",
    ].join("\n")),
    lowerCategoryText: "ROOF",
  });
  const roofDeltas = match.deltas.filter((d) => /roof rail/i.test(d.higherRow.description));
  assert.equal(roofDeltas.length, 2, JSON.stringify(match.deltas.map((d) => d.summary)));
  for (const delta of roofDeltas) {
    assert.equal(delta.kind, "reduced_paint");
    assert.ok(delta.groupedClearCoatChild, "child grouped into parent");
    assert.equal(delta.groupedClearCoatChild.hours, 0.4);
    assert.match(delta.summary, /refinish package differs by 0\.4 paint hr/);
    assert.match(delta.summary, /does not separately display it/);
  }
  // No standalone clear-coat findings remain.
  assert.ok(
    !match.deltas.some((d) => /clear coat/i.test(d.higherRow.description)),
    JSON.stringify(match.deltas.map((d) => d.summary))
  );
});

run("clear-coat child that does not reconcile exactly keeps both findings marked possible_overlap", () => {
  const match = matchEstimateLineItems({
    lowerRows: parseCccEstimateRows(["39 ROOF", "42 Rpr RT Roof rail 1.0 1.7"].join("\n")),
    higherRows: parseCccEstimateRows(["56 ROOF", "57 Rpr RT Roof rail 1.0 2.0", "58 Add for Clear Coat 0.4"].join("\n")),
    lowerCategoryText: "ROOF",
  });
  const parent = match.deltas.find((d) => /roof rail/i.test(d.higherRow.description));
  const child = match.deltas.find((d) => /clear coat/i.test(d.higherRow.description));
  assert.ok(parent && child, JSON.stringify(match.deltas.map((d) => d.summary)));
  assert.ok((parent.statusLabels ?? []).includes("POSSIBLE_OVERLAP"));
  assert.ok((child.statusLabels ?? []).includes("POSSIBLE_OVERLAP"));
  assert.match(child.summary, /may overlap/i);
});

run("identical-value R&I/Rpr battery pair downgrades to a coding-only change", () => {
  const match = matchEstimateLineItems({
    lowerRows: parseCccEstimateRows("26 R&I Battery 0.3 M"),
    higherRows: parseCccEstimateRows("35 Rpr Battery 0.3 M"),
  });
  assert.equal(match.deltas.length, 1);
  const delta = match.deltas[0];
  assert.equal(delta.kind, "operation_change");
  assert.equal(delta.codingOnlyChange, true);
  assert.ok((delta.statusLabels ?? []).includes("CODING_OR_DESCRIPTION_CHANGE"));
  assert.match(delta.summary, /coding difference/i);
  // A Blnd->Rpr escalation is NOT coding-only even with equal hours.
  const escalation = matchEstimateLineItems({
    lowerRows: parseCccEstimateRows("19 Blnd LT Fender 2.0"),
    higherRows: parseCccEstimateRows("26 Rpr LT Fender 2.0"),
  });
  assert.equal(escalation.deltas.length, 1);
  assert.ok(!escalation.deltas[0].codingOnlyChange);
});

run("every ESTIMATE TOTALS category row anchors as totals_row; legend lines never do", () => {
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
      makeLine("ESTIMATE TOTALS", 100),
      makeLine("Mechanical Labor 11.1 hrs @ $ 175.00 /hr 1,942.50", 112),
      makeLine("Aluminum Or Steel Repair 2.0 hrs @ $ 135.00 /hr 270.00", 124),
      makeLine("Miscellaneous 1,134.14", 136),
      makeLine("LABOR D=DIAGNOSTIC E=ELECTRICAL F=FRAME G=GLASS M=MECHANICAL P=PAINT LABOR S=STRUCTURAL", 148),
    ],
    { sourceDocumentRole: "source_estimate" }
  );
  const byText = (pattern) => anchors.find((anchor) => pattern.test(anchor.rowText));
  assert.equal(byText(/Mechanical Labor 11\.1/)?.anchorType, "totals_row");
  assert.equal(byText(/Aluminum Or Steel Repair/)?.anchorType, "totals_row");
  assert.equal(byText(/Miscellaneous 1,134/)?.anchorType, "totals_row");
  const legend = byText(/D=DIAGNOSTIC/);
  assert.notEqual(legend?.anchorType, "totals_row");
});

async function runAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(error && error.stack ? error.stack : error);
  }
}

// A category that exists ONLY on the lower estimate's totals (RO 22108
// Diagnostic Labor) anchors to the annotated estimate's "ESTIMATE TOTALS"
// block header. The render anchor gate read that header as page chrome
// ("starts with 'estimate', no digits") and silently dropped the finding —
// the report then under-reported the totals reconciliation by one category.
async function diagnosticLaborFindingSurvivesRender() {
  const { PDFDocument, StandardFonts } = require("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  const rows = [
    "1 FRONT BUMPER & GRILLE",
    "2 R&I bumper cover 1.4",
    "3 Repl Filter HEPA filter 165837500B 1 90.00",
    "ESTIMATE TOTALS",
    "Body Labor 10.0 hrs @ $ 90.00 /hr 900.00",
    "Subtotal 990.00",
    "Grand Total 1,090.00",
    "Total Cost of Repairs 1,090.00",
  ];
  rows.forEach((text, index) => {
    page.drawText(text, { x: 42, y: 700 - index * 24, size: 9, font });
  });
  const sourceBytes = await doc.save();
  const comparisonText = [
    "1 FRONT BUMPER & GRILLE",
    "2 R&I bumper cover 1.4",
    "3 Repl Filter HEPA filter 165837500B 1 70.00",
    "ESTIMATE TOTALS",
    "Body Labor 9.0 hrs @ $ 90.00 /hr 810.00",
    "Diagnostic Labor 1.0 hrs @ $ 90.00 /hr 90.00",
    "Subtotal 900.00",
    "Grand Total 980.00",
    "Total Cost of Repairs 980.00",
  ].join("\n");
  const result = await buildAnnotatedCitationDensityEstimatePdf({
    sourcePdfBytes: new Uint8Array(sourceBytes),
    sourceDocumentId: "ro22108-diag-synthetic",
    sourcePdfName: "Shop synthetic.pdf",
    uploadedFileNames: ["Shop synthetic.pdf", "SOR synthetic.pdf"],
    sourceText: rows.join("\n"),
    comparisonEstimateTexts: [
      { sourceDocumentId: "sor", fileName: "SOR synthetic.pdf", text: comparisonText, estimateRole: "carrier" },
    ],
    findings: [],
    findingGenerator: buildRequiredEstimatorDeltaFindings,
    request: { estimateRole: "shop" },
  });
  const metadataText = JSON.stringify(result.annotationMetadata ?? []);
  assert.match(
    metadataText,
    /category-only-on-lower-diagnostic-labor/i,
    "diagnostic-labor category finding renders"
  );
  const dropped = (result.debugTrace?.droppedFindings ?? []).filter((item) =>
    /category-only-on-lower/i.test(item.findingId ?? "")
  );
  assert.equal(dropped.length, 0, JSON.stringify(dropped));
}

runAsync(
  "a lower-only totals category anchored to the ESTIMATE TOTALS header survives the render gate",
  diagnosticLaborFindingSurvivesRender
).then(() => {
  console.log(`\nro22108Regression: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
