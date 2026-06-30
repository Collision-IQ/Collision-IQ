/* eslint-disable @typescript-eslint/no-require-imports */
// Tests for CCC make-abbreviation handling in vehicleContext.ts
// Run from project root: node src/lib/ai/vehicleContext.makeAbbrev.test.cjs

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

const { extractVehicleIdentityFromText } = require(path.join(cwd, "src/lib/ai/vehicleContext.ts"));

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

console.log("\nvehicleContext — CCC make abbreviation");

test("resolves the RO22006 'HOND' header line to a Honda Civic", () => {
  // Real RO22006 VEHICLE header (both estimates use the same truncated form).
  const text =
    "VEHICLE\n2020 HOND Civic Coupe EX w/Continuously Variable Transmission 2D CPE 4-1.5L Turbocharged Gasoline Gasoline Direct Injection BLACK\nVIN:2HGFC3B36LH352317";
  const vehicle = extractVehicleIdentityFromText(text, "attachment");
  assert.ok(vehicle, "vehicle identity should be extracted");
  assert.equal(vehicle.year, 2020);
  assert.equal(vehicle.make, "Honda");
  assert.match(vehicle.model || "", /civic/i);
  assert.equal(vehicle.vin, "2HGFC3B36LH352317");
});

test("expands a few other CCC make truncations", () => {
  const cases = [
    ["2021 TOYO Camry SE", "Toyota"],
    ["2019 CHEV Malibu LT", "Chevrolet"],
    ["2018 NISS Altima S", "Nissan"],
  ];
  for (const [line, expectedMake] of cases) {
    const vehicle = extractVehicleIdentityFromText(line, "attachment");
    assert.ok(vehicle, `should extract for "${line}"`);
    assert.equal(vehicle.make, expectedMake, `make for "${line}"`);
  }
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const { name, err } of failures) console.error(`\nFAILED: ${name}\n${err.stack || err.message}`);
  process.exit(1);
}
