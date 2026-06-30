/* eslint-disable @typescript-eslint/no-require-imports */
// Tests for buildCustomerTotalsSummary in customerReportPdfBuilder.ts
// Run from project root: node src/lib/ai/builders/customerReportTotals.test.cjs

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

const { buildCustomerTotalsSummary } = require(
  path.join(cwd, "src/lib/ai/builders/customerReportPdfBuilder.ts")
);

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

const labels = (rows) => rows.map((r) => r.label);
const byLabel = (rows, label) => rows.find((r) => r.label === label)?.value;

console.log("\nbuildCustomerTotalsSummary");

test("shows both totals and the difference (RO22006 figures)", () => {
  const rows = buildCustomerTotalsSummary(
    {
      shopEstimateGrandTotal: 4959.35,
      carrierTotalCostOfRepairs: 3652.71,
      grossRepairAppraisalGap: 1306.64,
    },
    "$3,652.71"
  );
  assert.deepEqual(labels(rows), [
    "Shop estimate total",
    "Carrier total cost of repairs",
    "Difference",
  ]);
  assert.equal(byLabel(rows, "Shop estimate total"), "$4,959.35");
  assert.equal(byLabel(rows, "Carrier total cost of repairs"), "$3,652.71");
  assert.equal(byLabel(rows, "Difference"), "$1,306.64");
});

test("never shows the carrier total alone as the headline", () => {
  const rows = buildCustomerTotalsSummary(
    { shopEstimateGrandTotal: 4959.35, carrierTotalCostOfRepairs: 3652.71 },
    "$3,652.71"
  );
  // The single ambiguous "Estimate Total" headline must not appear when a
  // comparison is available.
  assert.ok(!labels(rows).includes("Estimate Total"));
});

test("lists net-after-deductible separately from the repair total", () => {
  const rows = buildCustomerTotalsSummary(
    {
      shopEstimateGrandTotal: 4959.35,
      carrierTotalCostOfRepairs: 3652.71,
      carrierNetAfterDeductible: 3152.71,
      grossRepairAppraisalGap: 1306.64,
    },
    null
  );
  assert.equal(byLabel(rows, "Carrier net after deductible"), "$3,152.71");
  // Net is a distinct row, not the difference or a total.
  assert.equal(byLabel(rows, "Difference"), "$1,306.64");
});

test("computes difference from totals when gap is absent", () => {
  const rows = buildCustomerTotalsSummary(
    { shopEstimateGrandTotal: 4959.35, carrierTotalCostOfRepairs: 3652.71 },
    null
  );
  assert.equal(byLabel(rows, "Difference"), "$1,306.64");
});

test("falls back to single Estimate Total when no comparison totals exist", () => {
  const rows = buildCustomerTotalsSummary(undefined, "$4,959.35");
  assert.deepEqual(rows, [{ label: "Estimate Total", value: "$4,959.35" }]);
});

test("fallback shows Not provided when nothing is available", () => {
  const rows = buildCustomerTotalsSummary(null, null);
  assert.deepEqual(rows, [{ label: "Estimate Total", value: "Not provided" }]);
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const { name, err } of failures) console.error(`\nFAILED: ${name}\n${err.stack || err.message}`);
  process.exit(1);
}
