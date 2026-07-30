/* eslint-disable @typescript-eslint/no-require-imports */
// Regression tests for the scanned-PDF OCR path in extractPreviewDataFromBuffer:
// the sha256 OCR cache (RO 22047: re-uploading the same scanned EOR must not
// re-run the 45-80s tesseract pass) and the visible page-cap truncation note
// (11-page EOR losing its last page silently). pdf-parse, the OCR engine, and
// prisma are stubbed; the real ocrTextCache logic runs.
// Run: node src/lib/attachments/extractPreviewData.test.cjs

"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
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

// ── Stubs ────────────────────────────────────────────────────────────────────
const state = {
  pdfParseResult: { text: "", numpages: 11 },
  ocrCalls: 0,
  ocrResult: null,
  prismaRows: [],
  prismaCalls: 0,
};

// pdf-parse (npm package, CJS function export).
const pdfParsePath = require.resolve("pdf-parse");
require.cache[pdfParsePath] = {
  id: pdfParsePath,
  filename: pdfParsePath,
  loaded: true,
  exports: async () => state.pdfParseResult,
};

// OCR engine: recording stub. shouldOcrPdf/getPdfOcrMaxPages mirror the real
// signatures (their own logic is covered by ocrPdfFallback.test.cjs).
const ocrPath = path.join(cwd, "src/lib/attachments/ocrPdfFallback.ts");
require.cache[ocrPath] = {
  id: ocrPath,
  filename: ocrPath,
  loaded: true,
  exports: {
    shouldOcrPdf: (text, pageCount) => {
      const trimmed = (text || "").replace(/\s+/g, " ").trim().length;
      const pages = pageCount && pageCount > 0 ? pageCount : 1;
      return trimmed < Math.max(50, pages * 20);
    },
    getPdfOcrMaxPages: () => 25,
    ocrPdfBuffer: async () => {
      state.ocrCalls += 1;
      return state.ocrResult;
    },
  },
};

// prisma (lazily imported by ocrTextCache).
const prismaPath = path.join(cwd, "src/lib/prisma.ts");
require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: {
    prisma: {
      uploadedAttachment: {
        findMany: async () => {
          state.prismaCalls += 1;
          return state.prismaRows;
        },
      },
    },
  },
};

const { extractPreviewDataFromBuffer } = require(path.join(cwd, "src/lib/attachments/extractPreviewData.ts"));
const { OCR_TEXT_HEADER, buildOcrAttachmentText } = require(path.join(cwd, "src/lib/attachments/ocrTextCache.ts"));

const scannedPdf = Buffer.from("%PDF-1.4 fake scanned bytes for hashing");
const scannedPdfSha256 = crypto.createHash("sha256").update(scannedPdf).digest("hex");

function resetState() {
  state.pdfParseResult = { text: "", numpages: 11 };
  state.ocrCalls = 0;
  state.ocrResult = null;
  state.prismaRows = [];
  state.prismaCalls = 0;
}

let passed = 0;
let failed = 0;
const failures = [];
const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("text-layer PDF: no OCR, no hash, no cache lookup", async () => {
  state.pdfParseResult = { text: "A real estimate with plenty of extracted text. ".repeat(20), numpages: 3 };
  const result = await extractPreviewDataFromBuffer({
    buffer: scannedPdf,
    mimeType: "application/pdf",
    filename: "estimate.pdf",
  });
  assert.equal(result.pageCount, 3);
  assert.equal(result.sha256, undefined);
  assert.equal(state.ocrCalls, 0);
  assert.equal(state.prismaCalls, 0);
});

test("scanned PDF, cache miss: runs OCR, returns marker text + sha256", async () => {
  state.ocrResult = { text: "===== Page 1 =====\n19 Repl Absorber", pagesOcred: 11, pagesTotal: 11 };
  const result = await extractPreviewDataFromBuffer({
    buffer: scannedPdf,
    mimeType: "application/pdf",
    filename: "scanned-eor.pdf",
  });
  assert.equal(state.prismaCalls, 1);
  assert.equal(state.ocrCalls, 1);
  assert.equal(result.text.startsWith(OCR_TEXT_HEADER), true);
  assert.match(result.text, /19 Repl Absorber/);
  assert.doesNotMatch(result.text, /OCR page limit reached/);
  assert.equal(result.sha256, scannedPdfSha256);
});

test("scanned PDF, cache hit: reuses stored text and SKIPS OCR", async () => {
  const cachedText = buildOcrAttachmentText({ text: "CACHED EOR TEXT", pagesOcred: 11, pagesTotal: 11 });
  state.prismaRows = [{ text: cachedText, pageCount: 11 }];
  const result = await extractPreviewDataFromBuffer({
    buffer: scannedPdf,
    mimeType: "application/pdf",
    filename: "scanned-eor.pdf",
  });
  assert.equal(state.ocrCalls, 0); // the whole point: no 45-80s tesseract pass
  assert.equal(result.text, cachedText);
  assert.equal(result.sha256, scannedPdfSha256);
  assert.equal(result.pageCount, 11);
});

test("cache hit fills pageCount from the cached row when pdf-parse gave none", async () => {
  state.pdfParseResult = { text: "" }; // no numpages
  const cachedText = buildOcrAttachmentText({ text: "CACHED", pagesOcred: 4, pagesTotal: 4 });
  state.prismaRows = [{ text: cachedText, pageCount: 4 }];
  const result = await extractPreviewDataFromBuffer({
    buffer: scannedPdf,
    mimeType: "application/pdf",
  });
  assert.equal(result.pageCount, 4);
});

test("stale truncated cache row (old 10-page cap) is ignored and OCR re-runs", async () => {
  state.prismaRows = [{ text: buildOcrAttachmentText({ text: "PARTIAL", pagesOcred: 10, pagesTotal: 11 }), pageCount: 11 }];
  state.ocrResult = { text: "FULL ELEVEN PAGES", pagesOcred: 11, pagesTotal: 11 };
  const result = await extractPreviewDataFromBuffer({
    buffer: scannedPdf,
    mimeType: "application/pdf",
  });
  assert.equal(state.ocrCalls, 1);
  assert.match(result.text, /FULL ELEVEN PAGES/);
});

test("page-cap truncation is announced in the stored text, not silent", async () => {
  state.pdfParseResult = { text: "", numpages: 30 };
  state.ocrResult = { text: "FIRST 25 PAGES", pagesOcred: 25, pagesTotal: 30 };
  const result = await extractPreviewDataFromBuffer({
    buffer: scannedPdf,
    mimeType: "application/pdf",
  });
  assert.match(result.text, /only the first 25 of 30 pages/);
  assert.match(result.text, /PDF_OCR_MAX_PAGES/);
});

test("OCR failure still returns pdf-parse text with the hash for persistence", async () => {
  state.pdfParseResult = { text: "tiny", numpages: 11 };
  state.ocrResult = null; // OCR failed (never throws, returns null)
  const result = await extractPreviewDataFromBuffer({
    buffer: scannedPdf,
    mimeType: "application/pdf",
  });
  assert.equal(state.ocrCalls, 1);
  assert.equal(result.text, "tiny");
  assert.equal(result.sha256, scannedPdfSha256);
});

(async () => {
  console.log("\nextractPreviewData scanned-PDF OCR cache");
  for (const { name, fn } of tests) {
    resetState();
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}\n    ${err.message}`);
      failures.push({ name, err });
      failed++;
    }
  }
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const { name, err } of failures) console.error(`\nFAILED: ${name}\n${err.stack || err.message}`);
    process.exit(1);
  }
})();
