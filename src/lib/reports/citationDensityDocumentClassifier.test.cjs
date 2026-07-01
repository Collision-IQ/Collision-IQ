/* eslint-disable @typescript-eslint/no-require-imports */
// Tests for citationDensityDocumentClassifier — estimate vs support docs (RO22006 #1)
// Run from project root: node src/lib/reports/citationDensityDocumentClassifier.test.cjs

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

const { classifyCitationDensityDocument, resolveTriageRoles, scoreEstimateRoleSignals } = {
  ...require(path.join(cwd, "src/lib/reports/citationDensityDocumentClassifier.ts")),
  ...require(path.join(cwd, "src/lib/reports/estimateTriageClassifier.ts")),
};

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

const isEstimateLike = (filename, text) =>
  classifyCitationDensityDocument({ filename, text }).isEstimateLike;

console.log("\nestimate vs support classification (RO22006 #1)");

test("Shop Final estimate is estimate-like", () => {
  const text = "CONESTOGA COLLISION CENTER Preliminary Estimate RO Number: 22006 Grand Total 4,959.35 13 Repl LT Quarter glass 1.5";
  assert.equal(isEstimateLike("Shop Final 22006.pdf", text), true);
});

test("SOR-2 (Supplement of Record) is estimate-like", () => {
  const text = "GEICO Supplement of Record 2 with Summary Total Cost of Repairs 3,652.71 Net Cost of Repairs 3,652.71";
  assert.equal(isEstimateLike("SOR-2 22006.pdf", text), true);
});

test("parts/material invoice is NOT estimate-like", () => {
  const text = "INVOICE #5031430 Bill To: Conestoga Collision Amount Due $412.00 Parts invoice";
  assert.equal(isEstimateLike("Invoice5031430.pdf", text), false);
});

test("ADAS / scan report is NOT estimate-like", () => {
  const text = "REVVAdas Report ADAS Report pre-scan report post-scan report calibration report DTC results";
  assert.equal(isEstimateLike("ADAS_Report.pdf", text), false);
});

test("asTech scan invoice is NOT estimate-like", () => {
  const text = "asTech diagnostic invoice remit to amount due pre-repair scan";
  assert.equal(isEstimateLike("scan-invoice.pdf", text), false);
});

console.log("\n8-file run: pair still resolves to Shop + SOR (RO22006 #8)");

test("estimate pair excludes support docs and keeps Shop/SOR", () => {
  const docs = [
    { id: "shop", filename: "Shop Final 22006.pdf", text: "CONESTOGA COLLISION CENTER Repair Facility Written By: estimator Insurance Company: GEICO Grand Total 4,959.35" },
    { id: "sor", filename: "SOR-2 22006.pdf", text: "GEICO Supplement of Record 2 Appraiser Total Cost of Repairs 3,652.71" },
    { id: "invoice", filename: "Invoice5031430.pdf", text: "INVOICE #5031430 Bill To Amount Due $412.00" },
    { id: "adas", filename: "ADAS_Report.pdf", text: "REVVAdas Report ADAS Report calibration report" },
    { id: "material", filename: "material-invoice.pdf", text: "material invoice remit to amount due" },
    { id: "scan", filename: "scan-invoice.pdf", text: "asTech scan invoice amount due" },
  ];
  const estimateLike = docs.filter((d) => isEstimateLike(d.filename, d.text));
  const ids = estimateLike.map((d) => d.id).sort();
  assert.deepEqual(ids, ["shop", "sor"], `estimate-like docs should be shop+sor, got ${ids.join(",")}`);

  const scored = estimateLike.map((d) => ({ ...d, scores: scoreEstimateRoleSignals(d.filename, d.text) }));
  const { carrier, shop } = resolveTriageRoles(scored);
  assert.equal(shop.id, "shop");
  assert.equal(carrier.id, "sor");
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const { name, err } of failures) console.error(`\nFAILED: ${name}\n${err.stack || err.message}`);
  process.exit(1);
}
