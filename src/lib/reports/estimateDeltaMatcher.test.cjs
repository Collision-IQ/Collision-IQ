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
  compareEstimateTotals,
  normalizeTotalsCategoryKey,
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

run("flags denib/polish and color tint as expanded scope in a present category", () => {
  const lowerRows = parseCccEstimateRows(LOWER_SOR1);
  const higherRows = parseCccEstimateRows(HIGHER_SOR2);
  const result = matchEstimateLineItems({ lowerRows, higherRows });

  // M-5: both lines are genuinely absent from the lower estimate, but the
  // MISCELLANEOUS OPERATIONS header they sit under IS on the lower estimate
  // (it carries line 77, Color Sand and Buff). Section presence is now
  // resolved once from the lower document's own section labels, so both lines
  // report as expansion within a present category rather than as brand-new
  // operations — and, critically, they report the SAME way as each other.
  const denib = result.deltas.find((delta) => /denib/i.test(delta.summary));
  assert.ok(denib, "denib and polish should be reported");
  assert.equal(denib.kind, "expanded_scope");

  const colorTint = result.deltas.find((delta) => /color tint/i.test(delta.summary));
  assert.ok(colorTint, "color tint should be reported");
  assert.equal(colorTint.kind, "expanded_scope");
  assert.equal(denib.kind, colorTint.kind, "two rows under one header never disagree on presence");
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

run("expanded scope: an added line in a category the lower estimate already has is not 'missing'", () => {
  // Pre-teardown (lower) already has front-bumper work; post-teardown (higher)
  // adds another bumper line plus a genuinely new quarter-panel operation.
  const lower = parseCccEstimateRows("10 Rpr O/H front bumper 4.6");
  const higher = parseCccEstimateRows(
    ["15 Repl Bumper cover 1 1203.00 2.1", "50 Repl LT Quarter panel 1 800.00 5.0"].join("\n")
  );
  const result = matchEstimateLineItems({ lowerRows: lower, higherRows: higher });
  const bumper = result.deltas.find((d) => /bumper cover/i.test(d.higherRow.description));
  const quarter = result.deltas.find((d) => /quarter/i.test(d.higherRow.description));
  assert.ok(bumper, "bumper delta present");
  assert.equal(bumper.kind, "expanded_scope", "bumper category already present => expanded scope");
  assert.match(bumper.summary, /expanded\/added scope/i);
  assert.ok(quarter, "quarter delta present");
  assert.equal(quarter.kind, "missing_operation", "quarter is a new category => missing operation");
  assert.equal(result.expandedScopeCount, 1);
  assert.equal(result.missingOperationCount, 1);
});

run("OCR-derived lower estimate downgrades an unmatched line to unverified, not a confirmed omission", () => {
  const lower = parseCccEstimateRows("10 Rpr O/H front bumper 4.6");
  const higher = parseCccEstimateRows("50 Repl LT Quarter panel 1 800.00 5.0");
  const result = matchEstimateLineItems({ lowerRows: lower, higherRows: higher, lowerIsOcr: true });
  const quarter = result.deltas.find((d) => /quarter/i.test(d.higherRow.description));
  assert.ok(quarter);
  assert.equal(quarter.kind, "missing_operation");
  assert.equal(quarter.ocrUncertain, true, "OCR-derived lower estimate => ocrUncertain flag");
  assert.deepEqual(quarter.statusLabels, ["OCR_UNCERTAIN", "LOWER_ESTIMATE_OCR_LIMITATION", "VERIFY_AGAINST_SOURCE"]);
  assert.match(quarter.summary, /not a confirmed omission/i);
  assert.match(quarter.summary, /VERIFY_AGAINST_SOURCE/);
});

run("non-OCR lower estimate keeps a confirmed omission (no OCR labels)", () => {
  const lower = parseCccEstimateRows("10 Rpr O/H front bumper 4.6");
  const higher = parseCccEstimateRows("50 Repl LT Quarter panel 1 800.00 5.0");
  const result = matchEstimateLineItems({ lowerRows: lower, higherRows: higher });
  const quarter = result.deltas.find((d) => /quarter/i.test(d.higherRow.description));
  assert.ok(quarter);
  assert.equal(quarter.kind, "missing_operation");
  assert.equal(quarter.ocrUncertain, undefined);
  assert.equal(quarter.statusLabels, undefined);
});

run("category is confirmed via the section header appearing in the lower text (keyword-independent)", () => {
  // "ELECTRICAL" is not a fixed keyword, but the header is present in the lower
  // (OCR) text, so a module line under ELECTRICAL is expanded scope, not missing.
  const higher = [
    { ...parseCccEstimateRows("69 R&I Module 0.2")[0], section: "ELECTRICAL" },
  ];
  const lowerCategoryText = "... ELECTRICAL Battery Reset electrical components ...";
  const result = matchEstimateLineItems({
    lowerRows: parseCccEstimateRows("10 Rpr O/H front bumper 4.6"),
    higherRows: higher,
    lowerIsOcr: true,
    lowerCategoryText,
  });
  const module = result.deltas.find((d) => /module/i.test(d.higherRow.description));
  assert.ok(module);
  assert.equal(module.kind, "expanded_scope", "ELECTRICAL header present in lower text => expanded scope");
});

// ── Delta ledger discriminators (RO22059 patterns) ─────────────────────────
// The lower estimate is OCR-derived. The ledger must highlight genuine adds and
// operation changes but NOT unchanged rows that merely failed to match OCR.

// A representative OCR'd lower estimate (present lines carry description + part).
const OCR_LOWER =
  "FRONT BUMPER & GRILLE O/H front bumper Repl Bumper cover paint to match 175010150C Add for park sensor " +
  "FRONT LAMPS Repl LT Headlamp assy 156371300G R&I RT Repeater lamp R&I LT Repeater lamp " +
  "INSTRUMENT PANEL Rpr Instrument panel Note: Clean & inspect for damage";

run("ledger: a genuinely-added part (absent from OCR) is highlighted", () => {
  const higher = parseCccEstimateRows("19 Repl Absorber 163520300C 1 78.00 0.2").map((r) => ({ ...r, section: "FRONT BUMPER & GRILLE" }));
  const result = matchEstimateLineItems({
    lowerRows: parseCccEstimateRows(OCR_LOWER),
    higherRows: higher,
    lowerIsOcr: true,
    lowerCategoryText: OCR_LOWER,
  });
  const d = result.deltas.find((x) => /absorber/i.test(x.higherRow.description));
  assert.ok(d, "absorber delta present");
  assert.equal(d.annotate, true, "genuine add (part 163520300C absent from OCR) must be highlighted");
});

run("ledger: a routine line already in the OCR text is suppressed (annotate=false)", () => {
  const higher = parseCccEstimateRows("33 R&I RT Repeater lamp 0.3").map((r) => ({ ...r, section: "FRONT LAMPS" }));
  const result = matchEstimateLineItems({
    lowerRows: parseCccEstimateRows("XX header only"),
    higherRows: higher,
    lowerIsOcr: true,
    lowerCategoryText: OCR_LOWER,
  });
  const d = result.deltas.find((x) => /repeater/i.test(x.higherRow.description));
  assert.ok(d, "repeater delta recorded");
  assert.equal(d.annotate, false, "present-in-OCR routine line must not be highlighted");
  assert.equal(d.ocrUncertain, true);
});

run("ledger: OCR part-number garble (S<->5) does not create a false change", () => {
  // Same bumper cover; OCR read the part number 1750101S0C as 175010150C.
  const higher = parseCccEstimateRows("12 Repl Bumper cover paint to match 1750101S0C 1 1203.00 3.0");
  const result = matchEstimateLineItems({
    lowerRows: parseCccEstimateRows("Repl Bumper cover paint to match 175010150C 1 1203.00 3.0"),
    higherRows: higher,
    lowerIsOcr: true,
    lowerCategoryText: OCR_LOWER,
  });
  const d = result.deltas.find((x) => /bumper cover/i.test(x.higherRow.description) && x.annotate !== false);
  assert.equal(d, undefined, "garbled part number must not surface as a highlighted change");
});

run("ledger: an operation change on a matched line is highlighted (R&I/Rpr -> Repl)", () => {
  const higher = parseCccEstimateRows("89 Repl Instrument panel 156298700J 1 535.00 6.9").map((r) => ({ ...r, section: "INSTRUMENT PANEL" }));
  const result = matchEstimateLineItems({
    lowerRows: parseCccEstimateRows("Rpr Instrument panel"),
    higherRows: higher,
    lowerIsOcr: true,
    lowerCategoryText: OCR_LOWER,
  });
  const d = result.deltas.find((x) => /instrument panel/i.test(x.higherRow.description));
  assert.ok(d, "instrument panel delta present");
  assert.equal(d.annotate, true, "operation/labor escalation must be highlighted");
  // A changed matched line surfaces as operation_change or a labor/paint/part delta.
  assert.ok(["operation_change", "reduced_labor", "reduced_paint", "part_or_price_difference"].includes(d.kind));
});

run("C-2: unreconciled totals emit a LOUD reconciliation_gap delta, never silence", () => {
  const result = compareEstimateTotals({
    higher: {
      categories: [
        { category: "Body Labor", hours: 20, rate: 50, cost: 3000 },
        { category: "Mystery Structural Lane", hours: null, rate: null, cost: 4000 },
      ],
      salesTax: 0,
      grandTotal: 9000,
    },
    lower: {
      categories: [{ category: "Body Labor", hours: 10, rate: 50, cost: 1000 }],
      salesTax: 0,
      grandTotal: 2000,
    },
  });
  const gap = result.find((delta) => delta.kind === "reconciliation_gap");
  assert.ok(gap, "reconciliation_gap delta present");
  assert.match(gap.summary, /NOT explained/);
  assert.match(gap.summary, /withdrawn/);
  // The confident category-missing claim is withdrawn — it is what an
  // adjuster uses to discredit the whole document when it is wrong.
  assert.equal(result.some((delta) => delta.kind === "category_missing_on_lower"), false);
});

run("C-2: reconciled totals emit NO reconciliation_gap", () => {
  const result = compareEstimateTotals({
    higher: {
      categories: [{ category: "Body Labor", hours: 20, rate: 50, cost: 3000 }],
      salesTax: 0,
      grandTotal: 3000,
    },
    lower: {
      categories: [{ category: "Body Labor", hours: 10, rate: 50, cost: 1000 }],
      salesTax: 0,
      grandTotal: 1000,
    },
  });
  assert.equal(result.some((delta) => delta.kind === "reconciliation_gap"), false);
});

run("C-1: 22182 totals vocabulary resolves to concepts (Bonded Or Welded Panel Replace)", () => {
  assert.equal(normalizeTotalsCategoryKey("Bonded Or Welded Panel Replace"), "BONDEDORWELDEDPANEL");
  assert.equal(normalizeTotalsCategoryKey("Bonded Panel"), "BONDEDORWELDEDPANEL");
  assert.equal(normalizeTotalsCategoryKey("Welded Panel Replace"), "BONDEDORWELDEDPANEL");
  assert.equal(normalizeTotalsCategoryKey("Mechanical Labor"), "MECHANICAL");
  assert.equal(normalizeTotalsCategoryKey("Aluminum Or Steel Repair"), "ALUMINUM");
  assert.equal(normalizeTotalsCategoryKey("Miscellaneous"), "MISCELLANEOUS");
});

run("C-4: labor-class digit between labor and paint columns is the CLASS, never paint hours", () => {
  const pillar = parseCccEstimateRow("99 Repl RT Front pillar (ALU) 1095028S0N 1 1234.00 3.6 2 0.7");
  assert.equal(pillar.labor, 3.6);
  assert.equal(pillar.paint, 0.7, "the '2' is the labor class, not 2.0 paint hours");
  const wheelhouse = parseCccEstimateRow("107 Repl RT Outer wheelhouse (ALU) 1108148 1 500.00 2.0 1 0.7");
  assert.equal(wheelhouse.paint, 0.7);
  // A genuine decimal paint value still types as paint.
  const molding = parseCccEstimateRow("12 Repl Molding 123456 1 50.00 0.5 1.0");
  assert.equal(molding.labor, 0.5);
  assert.equal(molding.paint, 1.0);
});

run("C-6: product identifiers with digit+letter are atomic ('-3M', '3M')", () => {
  const { explodeGluedRow } = require("./estimateDeltaMatcher.ts");
  assert.match(explodeGluedRow("118 Heavy-Bodied Seam Sealer -3M 08308 2 24.86"), /-3M/);
  assert.match(explodeGluedRow("119 Controlled-Flow Seam Sealer 3M 08308 2 24.86"), / 3M /);
  // Glued value+marker forms still split (marker separated from its value).
  assert.match(explodeGluedRow("Hood28.32T1.0"), /\d T 1\.0/);
  assert.match(explodeGluedRow("146S01Pre-repair scan1m"), /scan1 m|scan 1 m/);
});

run("S-1: a manufacturer-prefixed product number never enters a value column", () => {
  // RO 22182 line 118 — the description wraps and rejoins AFTER the columns,
  // so the 3M product number 07333 sat where the labor cell is scanned. It was
  // reported as 7,333.0 body labor hours ($659,970 at $90/hr) against a
  // document declaring 85.6 hours in total.
  const wrapped = parseCccEstimateRow(
    "118 # Impact Resistant Structural 1 156.63 T Adhesive-3M 07333"
  );
  assert.equal(wrapped.labor, null, "3M product number must not read as labor hours");
  assert.equal(wrapped.paint, null);
  assert.equal(wrapped.price, 156.63);
  assert.equal(wrapped.qty, 1);
  // The identifier itself stays whole — a split token is un-searchable.
  assert.match(wrapped.rawText, /Adhesive-3M 07333/);

  // A leading-zero integer is catalog notation wherever it appears: qty,
  // money, and hour cells are never printed with one.
  const leadingZero = parseCccEstimateRow("120 # Static Mixing Nozzle 1 12.00 T 08194");
  assert.equal(leadingZero.labor, null);

  // Real part numbers are complete identifiers on their own, so the token
  // that follows them is still the real qty column.
  const recycled = parseCccEstimateRow(
    "8 * Sect LKQ RT quarter panel + 25% 445539221 1 951.88 24.5 4.5"
  );
  assert.equal(recycled.qty, 1);
  assert.equal(recycled.labor, 24.5);
  assert.equal(recycled.paint, 4.5);
});

run("S-1: per-row hours are bounded by the document's own SUBTOTALS rule", () => {
  const { parseCccSubtotalsRule } = require("./estimateDeltaMatcher.ts");
  const rule = parseCccSubtotalsRule("SUBTOTALS 3,878.36 85.6 31.2");
  assert.equal(rule.labor, 85.6);
  assert.equal(rule.paint, 31.2);
  assert.equal(parseCccSubtotalsRule("no rule printed here"), null);

  // A row claiming more hours than the whole document declares is a
  // column-identity failure, not a large value — the cell is dropped, the
  // row survives with its remaining measured cells.
  const rows = parseCccEstimateRows(
    [
      "REAR BUMPER",
      "12 Repl Bumper cover 123456 1 425.00 900.0 2.0",
      "13 Repl Bracket 123457 1 25.00 1.5 0.5",
      "SUBTOTALS 3,878.36 85.6 31.2",
    ].join("\n")
  );
  const impossible = rows.find((row) => row.lineNumber === 12);
  assert.equal(impossible.labor, null, "900.0 hr against a declared 85.6 must be dropped");
  assert.equal(impossible.paint, 2.0, "the paint cell is within the rule and survives");
  assert.equal(impossible.price, 425);
  const legitimate = rows.find((row) => row.lineNumber === 13);
  assert.equal(legitimate.labor, 1.5);
  assert.equal(legitimate.paint, 0.5);
});

run("M-2: part source is a typed field, and a disagreement is its own finding", () => {
  const { extractPartSource } = require("./estimateDeltaMatcher.ts");
  assert.deepEqual(extractPartSource("8 * Sect LKQ RT quarter panel + 25% 445539221 1 951.88"), [
    "LKQ",
    "Sect",
  ]);
  assert.deepEqual(
    extractPartSource("20 ** Repl A/M Bumper cover unpainted 3206028 1 425.00"),
    ["A/M"]
  );
  assert.deepEqual(extractPartSource("85 Repl RT Quarter panel 1073678S0B 1 1,139.55"), []);

  // RO 22182's first central dispute: GEICO wrote a RECYCLED, SECTIONED
  // quarter panel (quoted $761.50 from LKQ Venice, +25% markup) against the
  // shop's new OEM panel. The report called it "Priced differently" with a
  // $187.67 delta and never said LKQ, Sect, or recycled.
  const quarter = matchEstimateLineItems({
    lowerRows: parseCccEstimateRows("8 * Sect LKQ RT quarter panel + 25% 445539221 1 951.88 24.5 4.5"),
    higherRows: parseCccEstimateRows("85 Repl RT Quarter panel 1073678S0B 1 1,139.55 23.5 2 4.2"),
  });
  assert.equal(quarter.deltas.length, 1, JSON.stringify(quarter.deltas.map((d) => d.summary)));
  assert.equal(quarter.deltas[0].kind, "part_source_difference");
  assert.match(quarter.deltas[0].summary, /LKQ/);
  assert.match(quarter.deltas[0].summary, /Sect/);
  assert.match(quarter.deltas[0].summary, /new OEM/);

  // The second: an AFTERMARKET bumper cover against the shop's OEM cover,
  // previously typed `reduced_paint` with "A/M" unremarked.
  const bumper = matchEstimateLineItems({
    lowerRows: parseCccEstimateRows("20 ** Repl A/M Bumper cover unpainted w/o park brackets 3206028 1 425.00 2.0 1.0"),
    higherRows: parseCccEstimateRows("166 Repl Bumper cover unpainted w/o park brackets 1916698S0A 1 791.01 2.0 2.5"),
  });
  assert.equal(bumper.deltas.length, 1, JSON.stringify(bumper.deltas.map((d) => d.summary)));
  assert.equal(bumper.deltas[0].kind, "part_source_difference");
  assert.match(bumper.deltas[0].summary, /A\/M/);

  // Two rows that both print no prefix are both claiming new OEM and agree.
  const agree = matchEstimateLineItems({
    lowerRows: parseCccEstimateRows("20 Repl Bumper cover 3206028 1 425.00 2.0 1.0"),
    higherRows: parseCccEstimateRows("166 Repl Bumper cover 3206028 1 425.00 2.0 1.0"),
  });
  assert.equal(agree.deltas.length, 0, JSON.stringify(agree.deltas.map((d) => d.summary)));
});

run("M-3: the vehicle's paint system is read from both option blocks and both add-for lines", () => {
  const { detectPaintSystem, paintSystemAddHours } = require("./estimateDeltaMatcher.ts");
  // CCC prints the options block as one glued run, so the system name has no
  // word boundary in front of it.
  assert.equal(
    detectPaintSystem("CRUISE CONTROLHANDS FREE DEVICETHREE STAGE PAINTBACKUP CAMERA"),
    "THREE STAGE"
  );
  assert.equal(
    detectPaintSystem("CRUISE CONTROLHANDS FREE DEVICECLEARCOAT PAINTBACKUP CAMERA"),
    "CLEARCOAT"
  );
  // A three-stage finish also uses clearcoat, so the highest system wins.
  assert.equal(detectPaintSystem("THREE STAGE PAINT ... Add for Clear Coat"), "THREE STAGE");
  assert.equal(detectPaintSystem("REAR DEFOGGERBACKUP CAMERA"), null);

  // "Add" is a CCC operation code, so the hours must be read from the raw row.
  const shopRows = parseCccEstimateRows(
    ["39Add for Three Stage 0.8", "86Add for Three Stage 2.9", "167Add for Three Stage 2.0"].join("\n")
  );
  assert.equal(paintSystemAddHours(shopRows), 5.7);
  const carrierRows = parseCccEstimateRows(
    ["9Add for Clear Coat 1.8", "22Add for Clear Coat 0.5"].join("\n")
  );
  assert.equal(paintSystemAddHours(carrierRows), 2.3);
  // A tint/let-down line names the system but is not an add-for operation.
  assert.equal(
    paintSystemAddHours(parseCccEstimateRows("195 # Tint color > Three stage let down panel 1 1.0")),
    0
  );
});

run("M-5: no two findings in the same section assert opposite section presence", () => {
  // RO 22182 shipped findings 13-17 saying vehicle diagnostics was PRESENT on
  // the lower estimate and findings 22-25 saying the same section was MISSING
  // from it. GEICO's estimate has no diagnostics section, so half the report
  // was wrong and the reader had no way to tell which half.
  const lower = [
    "REAR BUMPER",
    "20 Repl Bumper cover 3206028 1 425.00 2.0 1.0",
    "MISCELLANEOUS OPERATIONS",
    "30 # Cover car 1 15.00",
  ].join("\n");
  const higher = [
    "REAR BUMPER",
    "60 Repl Bumper cover 3206028 1 425.00 2.0 1.0",
    "VEHICLE DIAGNOSTICS",
    "70 Rpr Pre repair scan 1 175.00 1.0",
    "71 Rpr Post repair scan 1 175.00 1.0",
    "72 Rpr Research DTC's 1 87.50 0.5",
    "MISCELLANEOUS OPERATIONS",
    "80 # Cover car 1 15.00",
    "81 # Mask for refinishing 1 10.00",
  ].join("\n");
  const result = matchEstimateLineItems({
    lowerRows: parseCccEstimateRows(lower),
    higherRows: parseCccEstimateRows(higher),
  });
  const kindsBySection = new Map();
  for (const delta of result.deltas) {
    if (delta.kind !== "missing_operation" && delta.kind !== "expanded_scope") continue;
    const section = delta.higherRow.section ?? "";
    const kinds = kindsBySection.get(section) ?? new Set();
    kinds.add(delta.kind);
    kindsBySection.set(section, kinds);
  }
  for (const [section, kinds] of kindsBySection) {
    assert.equal([...kinds].length, 1, `${section} asserts both presence and absence: ${[...kinds].join(", ")}`);
  }
  // The lower estimate labels its own sections, so its list is the authority:
  // it has no VEHICLE DIAGNOSTICS header, and it does have MISCELLANEOUS
  // OPERATIONS.
  assert.deepEqual([...(kindsBySection.get("VEHICLE DIAGNOSTICS") ?? [])], ["missing_operation"]);
  assert.deepEqual([...(kindsBySection.get("MISCELLANEOUS OPERATIONS") ?? [])], ["expanded_scope"]);
});

console.log(`\nestimateDeltaMatcher: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
