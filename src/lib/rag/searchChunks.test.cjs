/* eslint-disable @typescript-eslint/no-require-imports */
// Tests for src/lib/rag/searchChunks.ts dimension-guard behavior
// Run from project root: node src/lib/rag/searchChunks.test.cjs

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

// ── Mocks ─────────────────────────────────────────────────────────────────────
let sqlCallCount = 0;
let mockStoredDimension = 1536;

const originalLoad = Module._load;
Module._load = function interceptLoad(request, parent, isMain) {
  if (request === "@/lib/db") {
    return {
      sql: async () => {
        sqlCallCount += 1;
        return { rows: [{ id: "c1", content: "hit", file_id: "f1", distance: 0.1 }] };
      },
    };
  }
  if (request.endsWith("chunkSourceColumn")) {
    return { getChunkSourceColumn: async () => "source" };
  }
  if (request.endsWith("embeddingDimension")) {
    return { getStoredEmbeddingDimension: async () => mockStoredDimension };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const origWarn = console.warn;
console.warn = () => {};
const { searchChunks } = require(path.join(cwd, "src/lib/rag/searchChunks.ts"));
console.warn = origWarn;

// ── Runner ────────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];
async function test(name, fn) {
  sqlCallCount = 0;
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

function vec(n) {
  return new Array(n).fill(0.1);
}

(async () => {
  console.log("\nsearchChunks dimension guard");

  await test("skips vector search on dimension mismatch (1024 query vs 1536 stored)", async () => {
    mockStoredDimension = 1536;
    const rows = await searchChunks(vec(1024), 5);
    assert.deepEqual(rows, []);
    assert.equal(sqlCallCount, 0, "SQL must not run on a dimension mismatch");
  });

  await test("runs vector search when dimensions match", async () => {
    mockStoredDimension = 1536;
    const rows = await searchChunks(vec(1536), 5);
    assert.equal(rows.length, 1);
    assert.equal(sqlCallCount, 1);
  });

  await test("returns [] for an empty embedding without querying", async () => {
    const rows = await searchChunks([], 5);
    assert.deepEqual(rows, []);
    assert.equal(sqlCallCount, 0);
  });

  await test("runs when stored dimension is unknown (null)", async () => {
    mockStoredDimension = null;
    const rows = await searchChunks(vec(1024), 5);
    assert.equal(rows.length, 1);
    assert.equal(sqlCallCount, 1);
  });

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const { name, err } of failures) console.error(`\nFAILED: ${name}\n${err.stack || err.message}`);
    process.exit(1);
  }
})();
