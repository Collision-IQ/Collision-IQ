/* eslint-disable @typescript-eslint/no-require-imports */
// Tests for src/lib/ai/extractors/extractEstimateFacts.ts (estimateTotal basis)
// Run from project root: node src/lib/ai/extractors/extractEstimateFacts.test.cjs

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

const { extractEstimateFacts } = require(path.join(cwd, "src/lib/ai/extractors/extractEstimateFacts.ts"));

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

console.log("\nextractEstimateFacts — estimateTotal basis");

test("uses gross repair total, never net-after-deductible, when both present", () => {
  const text = [
    "USAA Casualty Insurance Company",
    "Total Cost of Repairs $16,773.29",
    "Less Deductible $1,000.00",
    "Net Cost of Repairs $15,773.29",
  ].join("\n");
  const facts = extractEstimateFacts({ text });
  assert.equal(facts.estimateTotal, 16773.29);
});

test("net is demoted below estimate/grand totals", () => {
  const text = [
    "Estimate Total $9,500.00",
    "Net Cost of Repairs $8,500.00",
  ].join("\n");
  const facts = extractEstimateFacts({ text });
  assert.equal(facts.estimateTotal, 9500.0);
});

test("falls back to net only when no gross total exists", () => {
  const text = "Net Cost of Repairs $7,250.00";
  const facts = extractEstimateFacts({ text });
  assert.equal(facts.estimateTotal, 7250.0);
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const { name, err } of failures) console.error(`\nFAILED: ${name}\n${err.stack || err.message}`);
  process.exit(1);
}
