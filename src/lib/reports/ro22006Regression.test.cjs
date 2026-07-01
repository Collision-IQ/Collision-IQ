/* eslint-disable @typescript-eslint/no-require-imports */
// RO22006 regression fixture (Shop Final 22006 vs SOR-2 22006).
// Pins the corrected behaviors (#1 vehicle, #2 totals, #3 mileage, #4/#5 delta)
// against the REAL header/line text extracted from the source PDFs.
// Run from project root: node src/lib/reports/ro22006Regression.test.cjs

"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const fs = require("node:fs");
const ts = require("typescript");

const cwd = process.cwd();
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveWithAlias(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    return originalResolveFilename.call(this, path.join(cwd, "src", request.slice(2)), parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
require.extensions[".ts"] = function compileTsModule(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
    },
    fileName: filename,
  });
  module._compile(compiled.outputText, filename);
};

const {
  extractEstimateTotalCandidate,
  scoreEstimateRoleSignals,
  resolveTriageRoles,
} = require(path.join(cwd, "src/lib/reports/estimateTriageClassifier.ts"));
const { extractEstimateFacts } = require(path.join(cwd, "src/lib/ai/extractors/extractEstimateFacts.ts"));
const { extractVehicleIdentityFromText } = require(path.join(cwd, "src/lib/ai/vehicleContext.ts"));
const { buildCustomerTotalsSummary } = require(path.join(cwd, "src/lib/ai/builders/customerReportPdfBuilder.ts"));
const { parseCccEstimateRows, matchEstimateLineItems } = require(path.join(cwd, "src/lib/reports/estimateDeltaMatcher.ts"));
const { extractEstimateComparisonTotals } = require(path.join(cwd, "src/lib/ai/builders/buildExportModel.ts"));

// ── Real header text (verbatim from the source PDFs) ────────────────────────
const SHOP_HEADER = [
  "conestogacollision.com",
  "961 Lancaster Avenue, Berwyn, PA 19312",
  "Preliminary Estimate",
  "RO Number: 22006",
  "Written By: VINCENT MENICHETTI, 739698",
  "Repair Facility",
  "Insurance Company:GEICO",
  "2020 HOND Civic Coupe EX w/Continuously Variable Transmission 2D CPE 4-1.5L Turbocharged Gasoline BLACK",
  "VIN:2HGFC3B36LH352317Interior Color:BLACKMileage In:106,732Vehicle Out:",
  "Grand Total4,959.35",
].join("\n");

const CARRIER_HEADER = [
  "GEICO",
  "Supplement of Record 2 with Summary",
  "Written By: FERNANDO CRACHA, License Number: 684066",
  "Adjuster: C1BU, (800) 841-3000 Business",
  "Appraiser Information:",
  "2020 HOND Civic Coupe EX w/Continuously Variable Transmission 2D CPE 4-1.5L Turbocharged Gasoline BLACK",
  "VIN: 2HGFC3B36LH352317Production Date:License: MWE8833Odometer: 106073Exterior Color: BLACK",
  "Total Cost of Repairs3,652.71",
  "Net Cost of Repairs3,652.71",
].join("\n");

let passed = 0;
let failed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    failures.push({ name, err });
    failed++;
  }
}

console.log("\nRO22006 regression fixture");

// #1 — vehicle identity resolves (no "Vehicle not specified")
test("#1 vehicle resolves to a 2020 Honda Civic with VIN", () => {
  const v = extractVehicleIdentityFromText(SHOP_HEADER, "attachment");
  assert.ok(v, "vehicle should be extracted");
  assert.equal(v.year, 2020);
  assert.equal(v.make, "Honda");
  assert.match(v.model || "", /civic/i);
  assert.equal(v.vin, "2HGFC3B36LH352317");
});

// Triage — shop vs carrier resolve to DISTINCT roles
test("classifies shop and carrier as distinct documents", () => {
  const items = [
    { id: "shop", scores: scoreEstimateRoleSignals("Shop Final 22006.pdf", SHOP_HEADER) },
    { id: "carrier", scores: scoreEstimateRoleSignals("SOR-2 22006.pdf", CARRIER_HEADER) },
  ];
  const { carrier, shop } = resolveTriageRoles(items);
  assert.ok(carrier && shop);
  assert.equal(carrier.id, "carrier");
  assert.equal(shop.id, "shop");
});

// #2 — totals 4959.35 / 3652.71 / 1306.64 (repair totals, not net)
test("#2 totals: shop 4959.35, carrier 3652.71, difference 1306.64", () => {
  const shopTotal = extractEstimateTotalCandidate(SHOP_HEADER);
  const carrierTotal = extractEstimateTotalCandidate(CARRIER_HEADER);
  assert.equal(shopTotal, 4959.35);
  assert.equal(carrierTotal, 3652.71); // repair total, not the net line
  assert.equal(Math.round((shopTotal - carrierTotal) * 100) / 100, 1306.64);
});

// #2 — customer report renders both totals
test("#2 customer report shows both totals + difference", () => {
  const rows = buildCustomerTotalsSummary(
    { shopEstimateGrandTotal: 4959.35, carrierTotalCostOfRepairs: 3652.71, grossRepairAppraisalGap: 1306.64 },
    "$3,652.71"
  );
  const labels = rows.map((r) => r.label);
  assert.ok(labels.includes("Shop estimate total"));
  assert.ok(labels.includes("Carrier total cost of repairs"));
  assert.ok(labels.includes("Difference"));
  assert.ok(!labels.includes("Estimate Total"));
});

// #4 — comparison report header gets BOTH totals from concatenated CCC labels
test("#4 comparison totals extract from concatenated Grand Total / Cost of Repairs", () => {
  const combined = [SHOP_HEADER, "Grand Total4,959.35", CARRIER_HEADER, "Total Cost of Repairs3,652.71", "Net Cost of Repairs3,652.71"].join("\n");
  const totals = extractEstimateComparisonTotals(combined);
  assert.ok(totals, "comparison totals should be extracted");
  assert.equal(totals.shopEstimateGrandTotal, 4959.35);
  assert.equal(totals.carrierTotalCostOfRepairs, 3652.71);
  assert.equal(totals.grossRepairAppraisalGap, 1306.64);
});

// #3 — mileage discrepancy captured
test("#3 mileage: shop 106,732 vs carrier 106,073 (minor discrepancy)", () => {
  const shopMileage = extractEstimateFacts({ text: SHOP_HEADER }).mileage;
  const carrierMileage = extractEstimateFacts({ text: CARRIER_HEADER }).mileage;
  assert.equal(shopMileage, 106732);
  assert.equal(carrierMileage, 106073);
  assert.equal(shopMileage - carrierMileage, 659); // minor
});

// #4/#5 — a scan present in both (only prefix/markup differs) is not missing
test("#4/#5 shared scan operation is not reported as missing", () => {
  const shop = "65 SublPre-repair scan 1 0.00 0.5";
  const carrier = "70*S02SublPre-repair scan +25% 1 0.00 0.5";
  const result = matchEstimateLineItems({
    lowerRows: parseCccEstimateRows(carrier),
    higherRows: parseCccEstimateRows(shop),
  });
  const scanMissing = result.deltas.find(
    (d) => /pre-repair scan|scan/i.test(d.summary) && d.kind === "missing_operation"
  );
  assert.equal(scanMissing, undefined, "scan present in both must not be a missing operation");
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const { name, err } of failures) console.error(`\nFAILED: ${name}\n${err.stack || err.message}`);
  process.exit(1);
}
