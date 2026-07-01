/* eslint-disable @typescript-eslint/no-require-imports */
// Tests for estimate link prioritization (RO22006 #9)
// Run from project root: node src/lib/ai/estimateLinkExtractor.priority.test.cjs

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
  extractEstimateLinksFromDocuments,
  isFetchableEstimateLink,
  prioritizeEstimateLinks,
  estimateLinkPriority,
} = require(path.join(cwd, "src/lib/ai/estimateLinkExtractor.ts"));

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

console.log("\nestimate link prioritization (RO22006)");

// Real RO22006 shop-estimate link context.
const SHOP_TEXT = [
  "https://collisionacademy.egnyte.com/fl/pmjPFyxKchGG",
  "65#REVVAdas Report 125.00 T 0.5",
  "Note: ADAS report available upon request and via this link: https://collisionacademy.egnyte.com/fl/3X9GqT79tpKx",
].join("\n");

test("extracts both Egnyte links as fetchable internal-repository sources", () => {
  const links = extractEstimateLinksFromDocuments([{ filename: "Shop Final 22006.pdf", text: SHOP_TEXT }]);
  const egnyte = links.filter((l) => /egnyte\.com$/.test(l.domain));
  assert.equal(egnyte.length, 2);
  assert.ok(egnyte.every((l) => l.classification === "internal_repository"));
  assert.ok(egnyte.every(isFetchableEstimateLink));
});

test("prioritizes OEM/ADAS/internal-repository links above generic references", () => {
  const links = [
    { url: "https://example.com/x", domain: "example.com", classification: "generic_reference", context: "" },
    { url: "https://collisionacademy.egnyte.com/fl/abc", domain: "collisionacademy.egnyte.com", classification: "internal_repository", context: "ADAS report available via this link" },
    { url: "https://techinfo.honda.com/proc", domain: "techinfo.honda.com", classification: "oem_procedure", context: "OEM procedure" },
  ];
  const ordered = prioritizeEstimateLinks(links);
  assert.equal(ordered[0].classification, "oem_procedure");
  assert.equal(ordered[1].classification, "internal_repository");
  assert.equal(ordered[2].classification, "generic_reference");
});

test("boosts an internal-repository link whose context signals ADAS", () => {
  const adas = { url: "https://collisionacademy.egnyte.com/fl/adas", domain: "collisionacademy.egnyte.com", classification: "internal_repository", context: "ADAS report" };
  const plain = { url: "https://collisionacademy.egnyte.com/fl/plain", domain: "collisionacademy.egnyte.com", classification: "internal_repository", context: "attachment" };
  assert.ok(estimateLinkPriority(adas) > estimateLinkPriority(plain));
});

test("unsupported links score zero", () => {
  assert.equal(
    estimateLinkPriority({ url: "https://facebook.com/x", domain: "facebook.com", classification: "unsupported", context: "" }),
    0
  );
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const { name, err } of failures) console.error(`\nFAILED: ${name}\n${err.stack || err.message}`);
  process.exit(1);
}
