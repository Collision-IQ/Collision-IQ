/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * RO22140-class regression fixture (SYNTHETIC — values from the adjudicated
 * Shop 22140 / SOR-1 22140 audit, no customer data).
 *
 * Audit FIX 1 (Test 1/Test 2 accuracy audit, build 1b4bf43c26): the glued
 * no-delimiter CCC export welds an 8-digit part number to a single-decimal
 * hours value ("323714303.4" = 32371430 + 3.4 hr). Every glued-run splitter
 * keyed on two-decimal money, so the seam survived: the row parsed with no
 * part and no labor, every matched SOR line read as 0 hours, and the delta
 * report emitted a ~33-finding "reduced labor: X hr vs 0 hr here" band on
 * lines that match exactly — while true value deltas (Flex $12 vs $6,
 * BetaSeal $37 vs Urethane Kit $20) never fired.
 *
 * Companion defect: splitGluedMoneyRun preferred qty 2 + $0.00 over $20.00
 * for "20.00" (the qty bonus outscored the whole-money read; "0.00" slid
 * past the leading-zero guard because its second char is "."), so the SOR
 * urethane kit priced $0 and the $37-vs-$20 comparison read as a $37 gap.
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
  matchEstimateLineItems,
} = require("./estimateDeltaMatcher.ts");

let passed = 0;
let failed = 0;
function run(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error && error.message ? `  ${error.message}` : error);
  }
}

// ---------------------------------------------------------------------------
// Glued SOR value-column parse (the smoking-gun rows from the audit)
// ---------------------------------------------------------------------------

run("part number glued to single-decimal hours splits (audit finding #11 row)", () => {
  const row = parseCccEstimateRow("59S01R&IR&I headliner 323714303.4");
  assert.ok(row, "row must parse");
  assert.equal(row.lineNumber, 59);
  assert.equal(row.partNumber, "32371430");
  assert.equal(row.labor, 3.4);
  assert.equal(row.description.toLowerCase().includes("323714303"), false,
    "part+hours blob must not leak into the description");
});

run("fully glued part+hours with no interior space splits", () => {
  const row = parseCccEstimateRow("9S01R&IR&I bumper cover 400160992.4");
  assert.ok(row, "row must parse");
  assert.equal(row.lineNumber, 9);
  assert.equal(row.partNumber, "40016099");
  assert.equal(row.labor, 2.4);
});

run("description glued to bare hours still parses (SOR line 112)", () => {
  const row = parseCccEstimateRow("112S01RprSET BACK WIRING/CONNECTORS0.5");
  assert.ok(row, "row must parse");
  assert.equal(row.lineNumber, 112);
  assert.equal(row.labor, 0.5);
});

run("desc-glued price never manufactures qty 2 + $0.00 (SOR urethane kit)", () => {
  const row = parseCccEstimateRow("45S01Urethane Kit20.00");
  assert.ok(row, "row must parse");
  assert.equal(row.price, 20.0, "price must be $20.00, not $0.00");
  assert.notEqual(row.qty, 2, "qty 2 is a split artifact");
});

run("qty-prefixed glued price still splits qty 1 + $20.00 (SOR prints qty first)", () => {
  const row = parseCccEstimateRow("45# S01Urethane Kit120.00T");
  assert.ok(row, "row must parse");
  assert.equal(row.qty, 1);
  assert.equal(row.price, 20.0);
});

run("standalone printed 0.00 price is still honored", () => {
  const row = parseCccEstimateRow("77 Repl Sunroof glass 12345678AB 1 0.00 0.5");
  assert.ok(row, "row must parse");
  assert.equal(row.price, 0.0);
  assert.equal(row.labor, 0.5);
});

run("part+qty+price money runs still split as before (no regression)", () => {
  const row = parseCccEstimateRow("12ReplBumper cover assy16788507081598.00 2.5");
  assert.ok(row, "row must parse");
  assert.equal(row.partNumber, "1678850708");
  assert.equal(row.qty, 1);
  assert.equal(row.price, 598.0);
  assert.equal(row.labor, 2.5);
});

run("part glued to TWO hour values splits all three columns", () => {
  const row = parseCccEstimateRow("31ReplHood panel 323715553.42.8");
  assert.ok(row, "row must parse");
  assert.equal(row.partNumber, "32371555");
  assert.equal(row.labor, 3.4);
  assert.equal(row.paint, 2.8);
});

// ---------------------------------------------------------------------------
// End-to-end: equal-value lines must produce ZERO reduced_labor findings,
// and true value deltas must fire — the audit's two symptoms of one bug.
// ---------------------------------------------------------------------------

function parseAll(lines) {
  return lines
    .map((text, index) =>
      parseCccEstimateRow(text, { anchorId: `row-${index}`, pageNumber: 1 })
    )
    .filter(Boolean);
}

run("no phantom reduced_labor on equal lines; true deltas fire (RO 22140 shape)", () => {
  // Higher estimate (shop) — spaced extraction.
  const higherRows = parseAll([
    "9 S01 R&I R&I bumper cover 40016099 2.4",
    "59 S01 R&I R&I headliner 32371430 3.4",
    "17 # S01 Flex Additive 1 12.00 T",
    "65 # S01 BetaSeal Express Urethane 1 37.00 T",
  ]);
  // Lower estimate (SOR) — glued no-delimiter export of the SAME operations,
  // equal hours on 9/59, lower prices on flex/urethane.
  const lowerRows = parseAll([
    "9S01R&IR&I bumper cover 400160992.4",
    "59S01R&IR&I headliner 323714303.4",
    "111# S01Flex Additive16.00T",
    "45# S01Urethane Kit120.00T",
  ]);
  assert.equal(higherRows.length, 4);
  assert.equal(lowerRows.length, 4);

  const { deltas } = matchEstimateLineItems({ lowerRows, higherRows });
  const reduced = deltas.filter((d) => d.kind === "reduced_labor");
  assert.equal(
    reduced.length, 0,
    `equal-hours lines must not report reduced labor, got: ${reduced
      .map((d) => d.higherRow.description).join("; ")}`
  );
  const priceDeltas = deltas.filter((d) => (d.priceDelta ?? 0) > 0 && d.lowerRow);
  const flex = priceDeltas.find((d) => /flex/i.test(d.higherRow.description));
  assert.ok(flex, "Flex Additive $12 vs $6 must fire as a matched value delta");
  assert.equal(flex.priceDelta, 6);
  const urethane = priceDeltas.find((d) => /betaseal|urethane/i.test(d.higherRow.description));
  assert.ok(
    urethane,
    "BetaSeal $37 vs Urethane Kit $20 must pair via the operation alias table and fire"
  );
  assert.equal(urethane.priceDelta, 17);
  assert.ok(
    !deltas.some(
      (d) => d.kind === "missing_operation" && /betaseal/i.test(d.higherRow.description)
    ),
    "aliased urethane twins must not double-report as missing"
  );
});

// ---------------------------------------------------------------------------
// FIX 2 — quantity consumption / shortfall: Cavity Wax ×3 here vs ×1 paid
// must produce 1 matched pair + 2 QUANTITY_SHORTFALL missing findings.
// Previously the bundled-allowance softening saw "CAVITY WAX" in the lower
// TEXT and demoted every overflow occurrence to "reconcile against invoices"
// (RO 22140: 4 shop occurrences vs 1 paid → zero findings).
// ---------------------------------------------------------------------------

run("cavity wax quantity shortfall fires per overflow occurrence", () => {
  const higherRows = parseAll([
    "35 # S01 Cavity Wax Plus-3M 08852-Per 5 Ounces 1 15.40 0.2",
    "50 # S01 Cavity Wax Plus-3M 08852-Per 5 Ounces 1 15.40 0.2",
    "98 # S01 Cavity Wax Plus-3M 08852-Per 5 Ounces 1 15.40 0.2",
    "9 S01 R&I R&I bumper cover 40016099 2.4",
  ]);
  const lowerRows = parseAll([
    "114# S01Cavity Wax Plus-3M 08852115.400.2",
    "9S01R&IR&I bumper cover 400160992.4",
  ]);
  assert.equal(higherRows.length, 4);
  assert.equal(lowerRows.length, 2);

  const { deltas } = matchEstimateLineItems({ lowerRows, higherRows });
  const shortfalls = deltas.filter(
    (d) => (d.statusLabels ?? []).includes("QUANTITY_SHORTFALL")
  );
  assert.equal(
    shortfalls.length, 2,
    `expected 2 shortfall findings (3 here vs 1 paid), got ${shortfalls.length}: ` +
      deltas.map((d) => `${d.kind}:${d.higherRow.description}`).join("; ")
  );
  for (const finding of shortfalls) {
    assert.equal(finding.kind, "missing_operation");
    assert.match(finding.summary, /quantity shortfall/i);
    assert.match(finding.summary, /appears 3 times/i);
    assert.match(finding.summary, /only 1 time\b/i);
  }
  // The overflow must never be softened to a bundled-allowance suggestion.
  assert.ok(
    !deltas.some(
      (d) => d.bundledEquivalentCandidate && /cavity wax/i.test(d.higherRow.description)
    ),
    "consumed cavity wax must not re-serve as a bundled allowance"
  );
});

// ---------------------------------------------------------------------------
// FIX 3 — section-missed: the WHEELS section (RT/LT wheel R&I m-flagged
// mechanical rows + lift & support) is entirely absent from the SOR. Every
// member finding must carry SECTION_MISSED and the section must be reported,
// while a section with any matched row must not.
// ---------------------------------------------------------------------------

const { parseCccEstimateRows } = require("./estimateDeltaMatcher.ts");

run("WHEELS section-missed fires; sections with matches do not", () => {
  const higherRows = parseCccEstimateRows(
    [
      "FRONT BUMPER",
      "9 S01 R&I R&I bumper cover 40016099 2.4",
      "55 WHEELS",
      "56 * R&I RT/Front R&I wheel m 0.2 M",
      "57 * R&I LT/Front R&I wheel m 0.2 M",
      "58 # Lift & support vehicle 1 0.5",
    ].join("\n")
  );
  const lowerRows = parseCccEstimateRows(
    ["FRONT BUMPER", "9S01R&IR&I bumper cover 400160992.4"].join("\n")
  );
  assert.equal(higherRows.length, 4, "3 wheels rows + 1 bumper row must parse");

  const result = matchEstimateLineItems({ lowerRows, higherRows });
  assert.deepEqual(result.missedSections, ["WHEELS"]);

  const wheelFindings = result.deltas.filter(
    (d) => d.lowerRow === null && /wheel|lift/i.test(d.higherRow.description)
  );
  assert.equal(
    wheelFindings.length, 3,
    `all 3 WHEELS rows must surface as findings, got: ${result.deltas
      .map((d) => `${d.kind}:${d.higherRow.description}`).join("; ")}`
  );
  for (const finding of wheelFindings) {
    assert.ok(
      (finding.statusLabels ?? []).includes("SECTION_MISSED"),
      `${finding.higherRow.description} must be tagged SECTION_MISSED`
    );
    assert.match(finding.summary, /entire section is missing/i);
  }
  const bumperFindings = result.deltas.filter((d) =>
    /bumper/i.test(d.higherRow.description)
  );
  for (const finding of bumperFindings) {
    assert.ok(
      !(finding.statusLabels ?? []).includes("SECTION_MISSED"),
      "matched FRONT BUMPER section must not be SECTION_MISSED"
    );
  }
});

// ---------------------------------------------------------------------------
// FIX 4 — P&M cap: lower estimate pays Paint Supplies flat ($750.00, blank
// basis) vs this estimate's computed 26.2 hrs @ $60.00 = $1,572.00. The cap
// must be detected (blank basis, never parsed as $0-rate), implied rate
// computed against the lower estimate's own paint hours (750 / 19.8 =
// $37.88), and the PA citation resolved from the jurisdiction table.
// ---------------------------------------------------------------------------

const { parseCccEstimateTotals } = require("./estimateDeltaMatcher.ts");
const {
  buildPmCapFlag,
  detectRepairFacilityState,
} = require("./jurisdictionRules.ts");

const SHOP_TOTALS_TEXT = [
  "ESTIMATE TOTALS",
  "Category Basis Rate Cost $",
  "Parts 4,631.66",
  "Body Labor 59.4 hrs @ $ 90.00 /hr 5,346.00",
  "Paint Labor 26.2 hrs @ $ 90.00 /hr 2,358.00",
  "Mechanical Labor 2.9 hrs @ $ 175.00 /hr 507.50",
  "Paint Supplies 26.2 hrs @ $ 60.00 /hr 1,572.00",
  "Miscellaneous 1,069.24",
  "Subtotal 15,484.40",
  "Grand Total 16,377.28",
].join("\n");
const SOR_TOTALS_TEXT = [
  "ESTIMATE TOTALS",
  "Category Basis Rate Cost $",
  "Parts 4,643.84",
  "Body Labor 50.4 hrs @ $ 90.00 /hr 4,536.00",
  "Paint Labor 19.8 hrs @ $ 90.00 /hr 1,782.00",
  "Mechanical Labor 4.5 hrs @ $ 175.00 /hr 787.50",
  "Paint Supplies 750.00",
  "Miscellaneous 56.00",
  "Other Charges 3.50",
  "Subtotal 12,558.84",
  "Total Cost of Repairs 13,312.37",
].join("\n");

run("flat Paint Supplies parses with a BLANK basis (never $0-rate, never dropped)", () => {
  const totals = parseCccEstimateTotals(SOR_TOTALS_TEXT);
  assert.ok(totals, "SOR totals must parse");
  const supplies = totals.categories.find((c) => /paint supplies/i.test(c.category));
  assert.ok(supplies, "flat Paint Supplies row must be captured");
  assert.equal(supplies.cost, 750.0);
  assert.equal(supplies.hours, null, "blank basis must stay null, not 0");
  assert.equal(supplies.rate, null, "blank rate must stay null, not 0");
});

run("P&M cap flag: detection math + PA citation from the jurisdiction table", () => {
  const flag = buildPmCapFlag({
    higher: parseCccEstimateTotals(SHOP_TOTALS_TEXT),
    lower: parseCccEstimateTotals(SOR_TOTALS_TEXT),
    state: "PA",
  });
  assert.ok(flag, "cap must be flagged");
  assert.equal(flag.cap, 750.0);
  assert.equal(flag.impliedRate, 37.88, "750.00 / 19.8 paint hrs = $37.88/hr");
  assert.match(flag.subjectBasis, /26\.2 hrs @ \$60\.00\/hr/);
  assert.equal(flag.verified, true);
  assert.match(flag.citation, /31 Pa\. Code Ch\. 62/);
  assert.match(flag.citation, /31 Pa\. Code Ch\. 146/);
});

run("unresearched state gets the generic block + JURISDICTION_UNVERIFIED hold", () => {
  const flag = buildPmCapFlag({
    higher: parseCccEstimateTotals(SHOP_TOTALS_TEXT),
    lower: parseCccEstimateTotals(SOR_TOTALS_TEXT),
    state: "OH",
  });
  assert.ok(flag, "cap detection is state-independent");
  assert.equal(flag.verified, false);
  assert.match(flag.citation, /JURISDICTION_UNVERIFIED/);
  assert.ok(!/Pa\. Code/.test(flag.citation), "PA citations are never borrowed");
});

run("no cap flag when the lower estimate also computes a basis", () => {
  const flag = buildPmCapFlag({
    higher: parseCccEstimateTotals(SHOP_TOTALS_TEXT),
    lower: parseCccEstimateTotals(
      SOR_TOTALS_TEXT.replace("Paint Supplies 750.00", "Paint Supplies 19.8 hrs @ $ 38.00 /hr 752.40")
    ),
    state: "PA",
  });
  assert.equal(flag, null, "computed basis is a rate difference, not a cap");
});

run("repair-facility state resolves from the shop header, never an RO number", () => {
  const shopHeader = "RO Number: 22140\n961 Lancaster Avenue, Berwyn, PA 19312";
  assert.equal(detectRepairFacilityState(shopHeader), "PA");
  const insurerFirst = "PO Box 660636, Dallas, TX 75266";
  assert.equal(
    detectRepairFacilityState(shopHeader, insurerFirst), "PA",
    "subject header wins over the comparison document"
  );
  assert.equal(detectRepairFacilityState("RO 22140 with no address"), null);
});

// ---------------------------------------------------------------------------
// Test 3 audit follow-ups
// ---------------------------------------------------------------------------

const { compareEstimateTotals } = require("./estimateDeltaMatcher.ts");

run("computed-vs-flat category emits a totals delta (cap finding's carrier)", () => {
  // Regression: once flat Paint Supplies PARSED (blank basis), the pair had
  // null rate/hours diffs and the cost branch required higher.rate === null —
  // no delta at all, so the P&M cap finding lost its carrier and 20+
  // PM_CAP_EVIDENCE tags dangled (Test 3 item 1).
  const deltas = compareEstimateTotals({
    higher: parseCccEstimateTotals(SHOP_TOTALS_TEXT),
    lower: parseCccEstimateTotals(SOR_TOTALS_TEXT),
  });
  const supplies = deltas.find((d) => /paint supplies/i.test(d.category));
  assert.ok(supplies, "Paint Supplies computed-vs-flat must emit a totals delta");
  assert.equal(supplies.kind, "category_amount_difference");
  assert.match(supplies.summary, /1,572\.00.*750\.00/);
});

run("generic clear-coat twins pair same-section first; cross-section copy goes missing", () => {
  // Test 3 item 4: the front-section "Add for Clear Coat" (1.0) consumed the
  // SOR's rear-door clear coat (2.5) cross-section; the negative mispaired
  // delta then suppressed the finding on a line the SOR genuinely omits.
  const higherRows = parseCccEstimateRows(
    [
      "FRONT BUMPER",
      "7 # Add for Clear Coat 1.0",
      "REAR DOOR",
      "121 # Add for Clear Coat 2.5",
    ].join("\n")
  );
  const lowerRows = parseCccEstimateRows(
    ["REAR DOOR", "60 # Add for Clear Coat 2.5"].join("\n")
  );
  assert.equal(higherRows.length, 2);
  assert.equal(lowerRows.length, 1);
  const result = matchEstimateLineItems({ lowerRows, higherRows });
  const rearMatched = result.matchedPairs.find((p) => p.higherRow.lineNumber === 121);
  assert.ok(rearMatched, "rear-door clear coat must claim its same-section twin");
  const frontFinding = result.deltas.find(
    (d) => d.lowerRow === null && d.higherRow.lineNumber === 7
  );
  assert.ok(
    frontFinding,
    `front clear coat must surface as unmatched, got: ${result.deltas
      .map((d) => `${d.kind}:${d.higherRow.lineNumber}`).join("; ")}`
  );
});

run("totals-block header never contaminates the last estimate row (line 158)", () => {
  const row = parseCccEstimateRow(
    "158 # Solid waste disposal 1 5.00 T Category Basis Rate Cost $"
  );
  assert.ok(row, "row must parse");
  assert.equal(row.price, 5.0);
  assert.ok(
    !/category|basis|rate|cost/i.test(row.description),
    `totals header leaked into description: "${row.description}"`
  );
  assert.ok(!/Category Basis/i.test(row.rawText), "rawText must stop at the totals boundary");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
