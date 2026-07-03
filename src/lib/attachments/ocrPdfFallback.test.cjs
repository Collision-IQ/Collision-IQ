/* eslint-disable @typescript-eslint/no-require-imports */
// Tests for shouldOcrPdf / isPdfOcrFallbackEnabled (the pure detection logic).
// The render+OCR path uses pdfjs/@napi-rs/canvas/tesseract.js and is validated
// end-to-end manually. Run: node src/lib/attachments/ocrPdfFallback.test.cjs

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
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  });
  module._compile(compiled.outputText, filename);
};

// The module imports ensurePdfJsNodePolyfills (which pulls report code). Stub that
// dependency so we can load the pure functions without the heavy graph.
const stubPath = path.join(cwd, "src/lib/reports/citationDensityRowAnchors.ts");
require.cache[stubPath] = { id: stubPath, filename: stubPath, loaded: true, exports: { ensurePdfJsNodePolyfills: async () => null } };

const { shouldOcrPdf, isPdfOcrFallbackEnabled } = require(path.join(cwd, "src/lib/attachments/ocrPdfFallback.ts"));

let passed = 0;
let failed = 0;
const failures = [];
function test(name, fn) {
  const prev = process.env.PDF_OCR_FALLBACK_DISABLED;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    failures.push({ name, err });
    failed++;
  } finally {
    if (prev === undefined) delete process.env.PDF_OCR_FALLBACK_DISABLED;
    else process.env.PDF_OCR_FALLBACK_DISABLED = prev;
  }
}

console.log("\nocrPdfFallback detection");

test("image-only PDF (0 chars) is flagged for OCR", () => {
  assert.equal(shouldOcrPdf("", 4), true);
  assert.equal(shouldOcrPdf("   \n  \t ", 2), true); // whitespace only
});

test("normal text PDF is not flagged", () => {
  assert.equal(shouldOcrPdf("x".repeat(15000), 7), false);
  assert.equal(shouldOcrPdf("x".repeat(200), 4), false); // 200 >= max(50, 80)
});

test("threshold scales with page count", () => {
  // 90 chars across 5 pages: 90 < max(50, 100) => OCR
  assert.equal(shouldOcrPdf("x".repeat(90), 5), true);
  // 90 chars, single page: 90 >= max(50, 20) => no OCR
  assert.equal(shouldOcrPdf("x".repeat(90), 1), false);
});

test("undefined page count treated as one page", () => {
  assert.equal(shouldOcrPdf("", undefined), true);
  assert.equal(shouldOcrPdf("x".repeat(60), undefined), false); // 60 >= 50
});

test("disable flag turns the fallback off", () => {
  process.env.PDF_OCR_FALLBACK_DISABLED = "1";
  assert.equal(isPdfOcrFallbackEnabled(), false);
  assert.equal(shouldOcrPdf("", 4), false);
  process.env.PDF_OCR_FALLBACK_DISABLED = "0";
  assert.equal(isPdfOcrFallbackEnabled(), true);
  assert.equal(shouldOcrPdf("", 4), true);
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const { name, err } of failures) console.error(`\nFAILED: ${name}\n${err.stack || err.message}`);
  process.exit(1);
}
