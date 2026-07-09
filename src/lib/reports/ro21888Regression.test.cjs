/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * RO21888-class regression fixture (SYNTHETIC — no customer data).
 *
 * Reproduces the structural patterns that broke the Delta Citation Density
 * comparison on a shop-final vs carrier supplement-of-record pair:
 *  - no-delimiter glued columns on BOTH documents
 *  - the lower estimate prints NO part-number column and S01/S02 prefixes
 *  - print-wrapped rows (description + value continuation lines)
 *  - ambiguous glued part/qty/price runs on hardware lines
 *  - RT/LT sibling rows and exact-vs-fuzzy match ordering
 *  - ESTIMATE TOTALS rate/hour differences and lower-only lines
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
  parseCccEstimateRows,
  matchEstimateLineItems,
  parseCccEstimateTotals,
  compareEstimateTotals,
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

// Higher (shop-final style): glued columns WITH a part-number column.
const SHOP_TEXT = `
FRONT BUMPER & GRILLE
7*ReplBumper cover5550001101999911,308.00Incl.2.6
11ReplLower panel5550002200121278.20
15#Set back, secure Protect wiring &
12.50T0.3
16*ReplPark sensor5550003300111195.000.20.2
21FENDER
24*ReplLT Wheel opng mldg w/o sport
pkg textured standard555-000-44-091240.00Incl.
25R&IRT Ft fender liner w/o off road pkg0.3
26ReplLT Ft fender liner w/o off road pkg55500055001355.60
30HOOD
31*RprHood1.03.2
32#Add for Clear Coat1.3
40SUSPENSION
41ReplRT Lower ball joint nut upper0011223344110.50
42ReplLT Lower ball joint nut upper0011223344110.50
43ReplRT Lower ball joint nut lower0011223344110.50
44ReplLT Lower ball joint nut lower0011223344110.50
45ReplGear assy nut0000000082696539.60
46ReplGear assy GLE-class w/o activ bdy
cntrl14,994.00m1.3
50MISCELLANEOUS OPERATIONS
51#Tint color10.5
52#Finish sand & polish (0.5 Refinish
per panel)
31.5
53#Clean vehicle for delivery15.00T0.5
SUBTOTALS23,918.0040.515.3
ESTIMATE TOTALS
CategoryBasisRateCost $
Parts16,930.28
Body Labor40.5 hrs@$ 75.00 /hr3,037.50
Paint Labor15.3 hrs@$ 75.00 /hr1,147.50
Paint Supplies15.3 hrs@$ 60.00 /hr918.00
Miscellaneous6,987.72
Subtotal29,021.00
Sales Tax$ 27,537.89@6.0000 %1,652.27
Grand Total30,673.27
`;

// Lower (carrier SOR style): NO part-number column, S-prefixes, same glue.
const SOR_TEXT = `
FRONT BUMPER & GRILLE
4S01  Repl Bumper cover11,308.00Incl.2.6
6S01  Repl Lower panel1214.00
8*S02  Set Back wiring and protect connecters12.50T0.3
9S01  Repl Park sensor1150.000.20.2
18FENDER
20*S02  Repl LT Wheel opng mldg w/o sport pkg textured standard1240.00Incl.
21S02  Repl LT Ft fender liner w/o off road pkg1355.60
30HOOD
31*S01  Rpr  Hood1.03.2
32S01  Add for Clear Coat0.6
40FRONT SUSPENSION
41S03  Repl LT Lower ball joint nut upper110.50
42S03  Repl LT Lower ball joint nut lower110.50
43S03  Repl Gear assy nut39.60
44S03  Repl Gear assy GLE-class w/o activ bdy cntrl14,994.00mIncl.
50MISCELLANEOUS OPERATIONS
51S02  Repl Battery pack assembly11,169.38
52S02  Repl Battery module upper1692.38
53S02  Repl Battery module lower1477.00
ESTIMATE TOTALS
CategoryBasisRateCost $
Parts19,504.94
Body Labor29.5 hrs@$ 60.00 /hr1,770.00
Paint Labor11.8 hrs@$ 60.00 /hr708.00
Mechanical Labor15.6 hrs@$ 98.00 /hr1,528.80
Paint Supplies11.8 hrs@$ 39.00 /hr460.20
Miscellaneous1,821.87
Subtotal25,793.81
Sales Tax$ 23,971.94@6.0000 %1,438.32
Total Cost of Repairs27,232.13
`;

const higherRows = parseCccEstimateRows(SHOP_TEXT);
const lowerRows = parseCccEstimateRows(SOR_TEXT);
const result = matchEstimateLineItems({
  lowerRows,
  higherRows,
  lowerIsOcr: false,
  lowerCategoryText: SOR_TEXT,
});
const annotated = result.deltas.filter((delta) => delta.annotate);
const annotatedFor = (lineNumber) =>
  annotated.filter((delta) => delta.higherRow.lineNumber === lineNumber);

run("wrapped rows rebuild: no fragment rows leak from continuations", () => {
  for (const row of [...higherRows, ...lowerRows]) {
    assert.ok(
      !/^(per panel\)|pkg |cntrl$)/i.test(row.description),
      `fragment row leaked: "${row.description}"`
    );
    assert.ok(row.description.length >= 3, `junk description: "${row.description}"`);
  }
  const wrapped = higherRows.find((row) => row.lineNumber === 24);
  assert.ok(wrapped, "wrapped molding row parsed");
  assert.equal(wrapped.price, 240);
});

run("glued value continuation ('12.50T0.3') merges instead of becoming row 12", () => {
  assert.ok(!higherRows.some((row) => row.lineNumber === 12), "no phantom line 12");
  const setBack = higherRows.find((row) => row.lineNumber === 15);
  assert.ok(setBack, "set back row parsed");
  assert.equal(setBack.labor, 0.3);
  assert.equal(setBack.price, 2.5);
});

run("lower estimate has no part column, so matched lines never emit part_added", () => {
  const partAdded = annotated.filter((delta) =>
    (delta.changedFields ?? []).includes("part_added")
  );
  assert.equal(partAdded.length, 0);
});

run("identical lines (bumper cover, park sensor spacer-class rows) are not annotated", () => {
  assert.equal(annotatedFor(7).length, 0, "bumper cover identical");
  assert.equal(annotatedFor(24).length, 0, "wrapped molding identical");
  assert.equal(annotatedFor(26).length, 0, "LT Ft fender liner identical");
  assert.equal(annotatedFor(31).length, 0, "Rpr Hood 1.0/3.2 identical on both");
});

run("real price differences are still flagged (lower panel, park sensor)", () => {
  const lowerPanel = annotatedFor(11);
  assert.equal(lowerPanel.length, 1);
  assert.equal(lowerPanel[0].kind, "part_or_price_difference");
  assert.equal(lowerPanel[0].priceDelta, 64.2);
  const parkSensor = annotatedFor(16);
  assert.equal(parkSensor.length, 1);
  assert.equal(parkSensor[0].priceDelta, 45);
});

run("hood clear coat labor reduction is flagged (1.3 vs 0.6)", () => {
  const clearCoat = annotatedFor(32);
  assert.equal(clearCoat.length, 1);
  assert.equal(clearCoat[0].kind, "reduced_labor");
  assert.equal(clearCoat[0].laborDelta, 0.7);
});

run("ambiguous glued hardware runs never emit split-artifact price deltas", () => {
  // Shop "0000000082696539.60" vs carrier "39.60" — different best splits, but
  // the carrier's price is a plausible alternate split of the shop run.
  const gearNut = annotatedFor(45);
  assert.equal(
    gearNut.filter((delta) => delta.kind === "part_or_price_difference").length,
    0,
    "gear nut price difference is a split artifact"
  );
});

run("exact matches claim rows first; RT-side additions flag, LT twins match", () => {
  assert.equal(annotatedFor(42).length, 0, "LT upper nut matches exactly");
  assert.equal(annotatedFor(44).length, 0, "LT lower nut matches exactly");
  assert.ok(annotatedFor(41).length >= 1, "RT upper nut is higher-only");
  assert.ok(annotatedFor(43).length >= 1, "RT lower nut is higher-only");
});

run("directional guard: R&I RT Ft liner never pairs with Repl LT Ft liner", () => {
  const rtLiner = annotatedFor(25);
  assert.ok(rtLiner.length >= 1, "RT liner is higher-only");
  assert.ok(
    rtLiner.every((delta) => delta.lowerRow === null),
    "RT liner must not match an LT row"
  );
});

run("higher-only misc operations are flagged (tint, sand & polish, clean up)", () => {
  assert.ok(annotatedFor(51).length >= 1, "tint color");
  assert.ok(annotatedFor(52).length >= 1, "finish sand & polish");
  assert.ok(annotatedFor(53).length >= 1, "clean vehicle");
  const sand = annotatedFor(52)[0];
  assert.equal(sand.higherRow.labor, 1.5, "qty 3 + 1.5 hr split, not 31.5 hr");
});

run("lower-only rows surface the carrier's battery lines", () => {
  const descriptions = result.lowerOnlyRows.map((row) => row.description.toLowerCase());
  assert.ok(
    descriptions.some((d) => d.includes("battery pack")),
    "battery pack assembly is lower-only"
  );
  assert.ok(
    descriptions.some((d) => d.includes("battery module upper")),
    "battery module upper is lower-only"
  );
  // The duplicated-pay pattern: 692.38 + 477.00 === 1,169.38 stays visible.
  const pack = result.lowerOnlyRows.find((row) =>
    row.description.toLowerCase().includes("battery pack")
  );
  const upper = result.lowerOnlyRows.find((row) =>
    row.description.toLowerCase().includes("battery module upper")
  );
  const lower = result.lowerOnlyRows.find((row) =>
    row.description.toLowerCase().includes("battery module lower")
  );
  assert.ok(pack && upper && lower);
  assert.equal(Math.round((upper.price + lower.price) * 100) / 100, pack.price);
});

run("totals lane: rates, mechanical-only-on-lower, and grand total gap", () => {
  const higherTotals = parseCccEstimateTotals(SHOP_TEXT);
  const lowerTotals = parseCccEstimateTotals(SOR_TEXT);
  assert.ok(higherTotals && lowerTotals);
  assert.equal(higherTotals.grandTotal, 30673.27);
  assert.equal(lowerTotals.grandTotal, 27232.13);

  const deltas = compareEstimateTotals({ higher: higherTotals, lower: lowerTotals });
  const byKind = (kind) => deltas.filter((delta) => delta.kind === kind);
  const rateCategories = byKind("rate_difference").map((delta) => delta.category);
  assert.deepEqual(rateCategories.sort(), ["Body Labor", "Paint Labor", "Paint Supplies"]);
  assert.equal(byKind("category_only_on_lower")[0]?.category, "Mechanical Labor");
  assert.ok(byKind("category_amount_difference").some((d) => d.category === "Miscellaneous"));
  assert.ok(byKind("category_amount_difference").some((d) => d.category === "Parts"));
  const total = byKind("total_difference")[0];
  assert.ok(total && /3,441\.14/.test(total.summary));
});

run("no phantom rows from totals/footer content", () => {
  for (const row of [...higherRows, ...lowerRows]) {
    assert.ok(
      !/subtotal|grand total|sales tax|estimate totals|categorybasis/i.test(row.description),
      `totals leaked into rows: "${row.description}"`
    );
  }
});

console.log(`\nro21888Regression: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
