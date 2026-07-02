/* eslint-disable @typescript-eslint/no-require-imports */
// RO21986 regression fixture (Root Estimate of Record vs Conestoga shop estimate).
// Pins the corrected behaviors from the RO21986 backlog against representative
// header/line text (real vehicle line is verbatim from the generated reports;
// totals/insurers/odometers reflect the confirmed source facts).
// Run from project root: node src/lib/reports/ro21986Regression.test.cjs
//
// Covered: #1 vehicle identity (Jeep not Chrysler), #2 insurer metadata conflict,
// #3 mileage discrepancy labeling, #7 DOI jurisdiction source (shop ZIP is
// fallback only), totals 841.27 / 7714.97 / gap 6873.70, and shop/carrier pairing.

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
  extractEstimateFacts,
  extractInsurerMentions,
  extractMileageReadings,
} = require(path.join(cwd, "src/lib/ai/extractors/extractEstimateFacts.ts"));
const { extractVehicleIdentityFromText, buildVehicleLabel } = require(path.join(cwd, "src/lib/ai/vehicleContext.ts"));
const { formatMileageDisplay } = require(path.join(cwd, "src/lib/ai/builders/customerReportPdfBuilder.ts"));
const { extractEstimateComparisonTotals } = require(path.join(cwd, "src/lib/ai/builders/buildExportModel.ts"));
const { extractEstimateTotalCandidate, scoreEstimateRoleSignals, resolveTriageRoles } = require(
  path.join(cwd, "src/lib/reports/estimateTriageClassifier.ts")
);
const { resolveJurisdiction } = require(path.join(cwd, "src/lib/ai/jurisdictionResolver.ts"));

// ── Representative header text ───────────────────────────────────────────────
const SHOP_HEADER = [
  "conestogacollision.com",
  "961 Lancaster Avenue, Berwyn, PA 19312",
  "Preliminary Estimate",
  "RO Number: 21986",
  "Written By: FRANCIS CURRAN",
  "Repair Facility",
  "Insurance:ALLSTATE",
  "Customer: THIELKE, SARAH",
  "2015 JEEP Cherokee Latitude FWD 4D UTV 4-2.4L Gasoline Sequential MPI BLUE",
  "VIN:    1C4PJLCB9FW707274Interior Color:BLACKMileage In:  94,418Vehicle Out:",
  "Grand Total7,714.97",
].join("\n");

const CARRIER_HEADER = [
  "Root Insurance Company",
  "Estimate of Record",
  "Written By: DESK REVIEW",
  "Claim Number: 000830295779D01",
  "2015 JEEP Cherokee Latitude FWD 4D UTV 4-2.4L Gasoline Sequential MPI BLUE",
  "VIN: 1C4PJLCB9FW707274Odometer: 108325Exterior Color: BLUE",
  "LKQ LT door assembly +25%",
  "All Scans through Elitek",
  "Total Cost of Repairs841.27",
  "Net Cost of Repairs841.27",
].join("\n");

const COMBINED = [SHOP_HEADER, CARRIER_HEADER].join("\n");

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

console.log("\nRO21986 regression fixture");

// #1 — vehicle is Jeep, not Chrysler; FCA stays manufacturer metadata only
test("#1 vehicle resolves to 2015 Jeep Cherokee Latitude (not Chrysler)", () => {
  const v = extractVehicleIdentityFromText(SHOP_HEADER, "attachment");
  assert.ok(v, "vehicle should be extracted");
  assert.equal(v.year, 2015);
  assert.equal(v.make, "Jeep");
  assert.match(v.model || "", /cherokee/i);
  assert.equal(v.vin, "1C4PJLCB9FW707274");
  assert.notEqual(v.make, "Chrysler");
  assert.match(v.manufacturer || "", /FCA/i); // parent stays as metadata
  assert.match(buildVehicleLabel(v), /2015 Jeep Cherokee/i);
});

// #2 — insurer metadata conflict: Root (carrier) vs Allstate (shop field)
test("#2 insurer metadata conflict detected (Root + Allstate), not collapsed", () => {
  const mentions = extractInsurerMentions(COMBINED);
  assert.ok(mentions.includes("Allstate"), "Allstate should be detected");
  assert.ok(mentions.includes("Root Insurance"), "Root Insurance should be detected");
  assert.ok(mentions.length >= 2, "two distinct insurer identities => conflict");
});

// #2 — "Root" is not a false positive without insurer context
test("#2 'root cause' prose does not register a Root insurer", () => {
  assert.deepEqual(extractInsurerMentions("the root cause was corrosion"), []);
});

// #3 — mileage discrepancy captured + labeled as a document mismatch
test("#3 mileage: shop 94,418 vs carrier 108,325, diff 13,907", () => {
  const readings = extractMileageReadings(COMBINED);
  assert.deepEqual(readings, [94418, 108325]);
  const shopMileage = extractEstimateFacts({ text: SHOP_HEADER }).mileage;
  const carrierMileage = extractEstimateFacts({ text: CARRIER_HEADER }).mileage;
  assert.equal(shopMileage, 94418);
  assert.equal(carrierMileage, 108325);
  assert.equal(carrierMileage - shopMileage, 13907);
});

test("#3 mileage display labels a document mismatch, not a repair issue", () => {
  const display = formatMileageDisplay(null, extractMileageReadings(COMBINED));
  assert.match(display, /94,418 \/ 108,325/);
  assert.match(display, /document mismatch/i);
  assert.match(display, /not necessarily a repair/i);
});

// Totals — 841.27 / 7714.97 / gap 6873.70 (repair totals, not net)
test("totals: shop 7714.97, carrier 841.27, gap 6873.70", () => {
  const totals = extractEstimateComparisonTotals(COMBINED);
  assert.ok(totals, "comparison totals should be extracted");
  assert.equal(totals.shopEstimateGrandTotal, 7714.97);
  assert.equal(totals.carrierTotalCostOfRepairs, 841.27);
  assert.equal(totals.grossRepairAppraisalGap, 6873.7);
  assert.equal(extractEstimateTotalCandidate(SHOP_HEADER), 7714.97);
  assert.equal(extractEstimateTotalCandidate(CARRIER_HEADER), 841.27);
});

// Pairing — shop and carrier resolve to distinct roles
test("pairing: shop and carrier classify as distinct documents", () => {
  const items = [
    { id: "shop", scores: scoreEstimateRoleSignals("Shop 21986 Mid repair 6-30-26.pdf", SHOP_HEADER) },
    { id: "carrier", scores: scoreEstimateRoleSignals("Estimate of Record 21986.pdf", CARRIER_HEADER) },
  ];
  const { carrier, shop } = resolveTriageRoles(items);
  assert.ok(carrier && shop, "both roles resolve");
  assert.equal(carrier.id, "carrier");
  assert.equal(shop.id, "shop");
});

// #7 — DOI jurisdiction source: shop ZIP is fallback only (never "shop_zip")
test("#7 DOI jurisdiction source demotes shop ZIP to fallback", () => {
  const resolved = resolveJurisdiction({ analysis: { rawEstimateText: COMBINED } });
  assert.notEqual(resolved.source, "shop_zip", "shop_zip must not be the primary governing source");
  assert.notEqual(resolved.source, "shop_address");
  if (resolved.stateCode) {
    assert.equal(resolved.stateCode, "PA");
    assert.match(resolved.source, /fallback|owner|insured/);
  }
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const { name, err } of failures) console.error(`\nFAILED: ${name}\n${err.stack || err.message}`);
  process.exit(1);
}
