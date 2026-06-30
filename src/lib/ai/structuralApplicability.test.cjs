/* eslint-disable @typescript-eslint/no-require-imports */
// Tests for src/lib/ai/structuralApplicability.ts (structural measurement aliases)
// Run from project root: node src/lib/ai/structuralApplicability.test.cjs

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

const { deriveStructuralApplicability } = require(path.join(cwd, "src/lib/ai/structuralApplicability.ts"));

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

console.log("\nderiveStructuralApplicability — structural measurement aliases");

// Each phrase, as it commonly appears on a shop or carrier estimate, must be
// recognized as a present structural-measurement / setup operation.
const measurementPhrases = [
  "Set up vehicle on frame bench",
  "Setup and Measure - Rack",
  "Set up and measure",
  "Setup & Measure",
  "Verify dimensional accuracy",
  "Structural measurement",
  "3D measurement",
  "Measure rack",
];

for (const phrase of measurementPhrases) {
  test(`recognizes "${phrase}"`, () => {
    const result = deriveStructuralApplicability({ rawText: `Line 1 ${phrase} 3.0 hrs` });
    assert.equal(
      result.structuralMeasurementVerification,
      true,
      `expected structuralMeasurementVerification=true for "${phrase}"`
    );
  });
}

test("frame bench is recognized as a setup operation", () => {
  const result = deriveStructuralApplicability({ rawText: "Set up vehicle on frame bench" });
  assert.equal(result.structuralSetupRequired, true);
});

test("does not fire on negated measurement language", () => {
  const result = deriveStructuralApplicability({ rawText: "No measure required; not on frame bench" });
  assert.equal(result.structuralMeasurementVerification, false);
});

test("stays quiet on an unrelated cosmetic estimate", () => {
  const result = deriveStructuralApplicability({ rawText: "Refinish bumper cover; blend left fender" });
  assert.equal(result.structuralMeasurementVerification, false);
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const { name, err } of failures) console.error(`\nFAILED: ${name}\n${err.stack || err.message}`);
  process.exit(1);
}
