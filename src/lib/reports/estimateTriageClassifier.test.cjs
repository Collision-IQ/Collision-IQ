/* eslint-disable @typescript-eslint/no-require-imports */
// Tests for src/lib/reports/estimateTriageClassifier.ts
// Run from project root: node src/lib/reports/estimateTriageClassifier.test.cjs

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

// Generic fixtures (not tied to any real file) — a shop estimate that *names*
// the insurer in a labeled field, and a carrier supplement-of-record.
const shopText = [
  "CONESTOGA COLLISION CENTER",
  "Repair Facility Estimate",
  "Written By: Vincent Menichetti (Estimator)",
  "Insurance Company: USAA",
  "Repair Order RO# 21896",
  "conestogacollision.com",
  "Total Cost of Repairs $17,397.20",
].join("\n");

const carrierText = [
  "USAA Casualty Insurance Company",
  "Supplement of Record",
  "Appraiser: J. Smith",
  "Quality Replacement Parts (QRP)",
  "Claim Number: 1234",
  "Total Cost of Repairs $16,773.29",
  "Less Deductible $1,000.00",
  "Net Cost of Repairs $15,773.29",
].join("\n");

console.log("\nextractEstimateTotalCandidate");

test("prefers repair total over net-after-deductible", () => {
  assert.equal(extractEstimateTotalCandidate(carrierText), 16773.29);
});

test("returns shop repair total", () => {
  assert.equal(extractEstimateTotalCandidate(shopText), 17397.20);
});

test("returns null on empty", () => {
  assert.equal(extractEstimateTotalCandidate("   "), null);
});

console.log("\nscoreEstimateRoleSignals");

test("carrier supplement scores carrier-leaning", () => {
  const s = scoreEstimateRoleSignals("carrier.pdf", carrierText);
  assert.ok(s.carrier > s.shop, `expected carrier>${s.shop}, got ${s.carrier}`);
});

test("shop estimate that names insurer still scores shop-leaning", () => {
  const s = scoreEstimateRoleSignals("shop.pdf", shopText);
  assert.ok(s.shop > s.carrier, `expected shop>${s.carrier}, got ${s.shop}`);
});

console.log("\nresolveTriageRoles");

test("two estimates resolve to DISTINCT files (the core bug)", () => {
  const items = [
    { id: "shop", scores: scoreEstimateRoleSignals("shop.pdf", shopText), total: 17397.20 },
    { id: "carrier", scores: scoreEstimateRoleSignals("carrier.pdf", carrierText), total: 16773.29 },
  ];
  const { carrier, shop } = resolveTriageRoles(items);
  assert.ok(carrier && shop, "both roles assigned");
  assert.notEqual(carrier.id, shop.id, "carrier and shop must be different files");
  assert.equal(carrier.id, "carrier");
  assert.equal(shop.id, "shop");
});

test("two same-leaning estimates still resolve to distinct files", () => {
  // Both look shop-ish; we must never assign the same object to both roles.
  const items = [
    { id: "a", scores: scoreEstimateRoleSignals("a.pdf", shopText), total: 100 },
    { id: "b", scores: scoreEstimateRoleSignals("b.pdf", shopText), total: 200 },
  ];
  const { carrier, shop } = resolveTriageRoles(items);
  assert.ok(carrier && shop);
  assert.notEqual(carrier.id, shop.id);
});

test("single estimate assigns one role only", () => {
  const items = [{ id: "only", scores: scoreEstimateRoleSignals("c.pdf", carrierText), total: 16773.29 }];
  const { carrier, shop } = resolveTriageRoles(items);
  assert.ok(carrier && !shop, "carrier-leaning single doc → carrier only");
});

test("gap is computed from repair totals, not net", () => {
  const shopTotal = extractEstimateTotalCandidate(shopText);
  const carrierTotal = extractEstimateTotalCandidate(carrierText);
  assert.equal(Math.round((shopTotal - carrierTotal) * 100) / 100, 623.91);
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const { name, err } of failures) console.error(`\nFAILED: ${name}\n${err.stack || err.message}`);
  process.exit(1);
}
