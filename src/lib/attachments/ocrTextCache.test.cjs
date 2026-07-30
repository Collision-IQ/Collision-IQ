/* eslint-disable @typescript-eslint/no-require-imports */
// Tests for the sha256-keyed OCR text cache: marker/note formatting, the
// truncation-aware reuse decision, and the prisma-backed lookup (stubbed DB).
// Run: node src/lib/attachments/ocrTextCache.test.cjs

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

// ocrTextCache -> ocrPdfFallback -> citationDensityRowAnchors (heavy report
// graph). Stub the anchor module like the sibling ocrPdfFallback test does.
const anchorsPath = path.join(cwd, "src/lib/reports/citationDensityRowAnchors.ts");
require.cache[anchorsPath] = { id: anchorsPath, filename: anchorsPath, loaded: true, exports: { ensurePdfJsNodePolyfills: async () => null } };

// Stub the lazy prisma import with a controllable findMany.
const prismaState = {
  rows: [],
  lastFindManyArgs: null,
  throwOnFindMany: false,
};
const prismaPath = path.join(cwd, "src/lib/prisma.ts");
require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: {
    prisma: {
      uploadedAttachment: {
        findMany: async (args) => {
          prismaState.lastFindManyArgs = args;
          if (prismaState.throwOnFindMany) throw new Error("db down");
          return prismaState.rows;
        },
      },
    },
  },
};

const {
  OCR_TEXT_MARKER,
  OCR_TEXT_HEADER,
  buildOcrAttachmentText,
  buildOcrTruncationNote,
  parseOcrTruncationNote,
  isCachedOcrTextReusable,
  findCachedOcrText,
} = require(path.join(cwd, "src/lib/attachments/ocrTextCache.ts"));

let passed = 0;
let failed = 0;
const failures = [];
const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("header starts with the marker the cache lookup matches on", () => {
  assert.equal(OCR_TEXT_HEADER.startsWith(OCR_TEXT_MARKER), true);
  // Exact legacy prefix: existing rows and the report-side sniffer depend on it.
  assert.equal(OCR_TEXT_MARKER, "[[OCR text recovered");
  assert.match(OCR_TEXT_HEADER, /OCR text recovered from a scanned/);
});

test("buildOcrAttachmentText without truncation is header + body", () => {
  const text = buildOcrAttachmentText({ text: "===== Page 1 =====\nBODY", pagesOcred: 3, pagesTotal: 3 });
  assert.equal(text, `${OCR_TEXT_HEADER}\n\n===== Page 1 =====\nBODY`);
  assert.equal(parseOcrTruncationNote(text), null);
});

test("buildOcrAttachmentText appends a visible note when pages were dropped", () => {
  const text = buildOcrAttachmentText({ text: "BODY", pagesOcred: 10, pagesTotal: 11 });
  assert.equal(text.startsWith(OCR_TEXT_MARKER), true);
  assert.match(text, /only the first 10 of 11 pages/);
  assert.match(text, /PDF_OCR_MAX_PAGES/);
});

test("truncation note round-trips through the parser", () => {
  const note = buildOcrTruncationNote(10, 11);
  assert.deepEqual(parseOcrTruncationNote(`prefix\n${note}`), { pagesOcred: 10, pagesTotal: 11 });
  assert.equal(parseOcrTruncationNote("no note here"), null);
});

test("un-truncated cache text is always reusable", () => {
  assert.equal(isCachedOcrTextReusable(`${OCR_TEXT_HEADER}\n\nBODY`, 25), true);
});

test("truncated cache text is NOT reused when the current cap covers more pages", () => {
  const text = buildOcrAttachmentText({ text: "BODY", pagesOcred: 10, pagesTotal: 11 });
  // Old 10-page run, current 25-page cap: re-OCR recovers the dropped page.
  assert.equal(isCachedOcrTextReusable(text, 25), false);
});

test("truncated cache text IS reused when the current cap can do no better", () => {
  const text = buildOcrAttachmentText({ text: "BODY", pagesOcred: 10, pagesTotal: 11 });
  assert.equal(isCachedOcrTextReusable(text, 10), true);
  const full30 = buildOcrAttachmentText({ text: "BODY", pagesOcred: 25, pagesTotal: 30 });
  assert.equal(isCachedOcrTextReusable(full30, 25), true);
});

test("findCachedOcrText queries by sha256 + marker prefix and returns the newest reusable row", async () => {
  prismaState.rows = [{ text: `${OCR_TEXT_HEADER}\n\nCACHED BODY`, pageCount: 11 }];
  const hit = await findCachedOcrText("abc123");
  assert.deepEqual(hit, { text: `${OCR_TEXT_HEADER}\n\nCACHED BODY`, pageCount: 11 });
  assert.equal(prismaState.lastFindManyArgs.where.sha256, "abc123");
  assert.deepEqual(prismaState.lastFindManyArgs.where.text, { startsWith: OCR_TEXT_MARKER });
  assert.deepEqual(prismaState.lastFindManyArgs.orderBy, { createdAt: "desc" });
});

test("findCachedOcrText skips stale truncated rows in favor of a fuller run", async () => {
  const prevMax = process.env.PDF_OCR_MAX_PAGES;
  process.env.PDF_OCR_MAX_PAGES = "25";
  try {
    const truncated = buildOcrAttachmentText({ text: "PARTIAL", pagesOcred: 10, pagesTotal: 11 });
    const full = buildOcrAttachmentText({ text: "FULL", pagesOcred: 11, pagesTotal: 11 });
    prismaState.rows = [{ text: truncated, pageCount: 11 }, { text: full, pageCount: 11 }];
    const hit = await findCachedOcrText("abc123");
    assert.equal(hit.text, full);

    // Only the stale truncated row exists: no reuse, caller re-runs OCR.
    prismaState.rows = [{ text: truncated, pageCount: 11 }];
    assert.equal(await findCachedOcrText("abc123"), null);
  } finally {
    if (prevMax === undefined) delete process.env.PDF_OCR_MAX_PAGES;
    else process.env.PDF_OCR_MAX_PAGES = prevMax;
  }
});

test("findCachedOcrText returns null on empty hash, no rows, or lookup failure", async () => {
  prismaState.rows = [];
  assert.equal(await findCachedOcrText(""), null);
  assert.equal(await findCachedOcrText("abc123"), null);
  prismaState.throwOnFindMany = true;
  assert.equal(await findCachedOcrText("abc123"), null); // never throws
  prismaState.throwOnFindMany = false;
});

(async () => {
  console.log("\nocrTextCache");
  for (const { name, fn } of tests) {
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
