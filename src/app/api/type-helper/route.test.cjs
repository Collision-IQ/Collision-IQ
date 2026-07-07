/* eslint-disable @typescript-eslint/no-require-imports */
// Tests for src/app/api/type-helper/route.ts
// Run from project root: node src/app/api/type-helper/route.test.cjs

"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const fs = require("node:fs");
const ts = require("typescript");

// ─── TypeScript transpiler + alias resolution ─────────────────────────────────

const cwd = process.cwd();

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveWithAlias(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    const absolute = path.join(cwd, "src", request.slice(2));
    return originalResolveFilename.call(this, absolute, parent, isMain, options);
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

// ─── Mocks ────────────────────────────────────────────────────────────────────

class MockUnauthorizedError extends Error {
  constructor(message = "Authentication is required.") {
    super(message);
    this.name = "UnauthorizedError";
    this.status = 401;
  }
}

let mockAuthShouldFail = false;
const mockRequireCurrentUser = async () => {
  if (mockAuthShouldFail) throw new MockUnauthorizedError();
  return { user: { id: "test-user-id" } };
};

let modelCallCount = 0;
let mockModelImpl = async () => ({ text: "corrected", model: "claude-fable-5", stopReason: "end_turn" });
const mockGenerateClaudeMessage = async (params) => {
  modelCallCount += 1;
  return mockModelImpl(params);
};

function makeNextResponseMock() {
  return {
    json(body, init) {
      const status = (init && init.status) != null ? init.status : 200;
      return { _status: status, _body: body, status, async json() { return body; } };
    },
  };
}

const originalLoad = Module._load;
Module._load = function interceptLoad(request, parent, isMain) {
  if (request === "next/server") {
    return { NextResponse: makeNextResponseMock(), NextRequest: class {} };
  }
  if (request === "@/lib/auth/require-current-user") {
    return { requireCurrentUser: mockRequireCurrentUser, UnauthorizedError: MockUnauthorizedError };
  }
  if (request === "@/lib/anthropic") {
    return { generateClaudeMessage: mockGenerateClaudeMessage };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { POST } = require(path.join(cwd, "src", "app", "api", "type-helper", "route.ts"));

function makeRequest(body) {
  return { json: async () => body };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("unauthenticated → 401 and the model is never called", async () => {
  mockAuthShouldFail = true;
  modelCallCount = 0;
  const res = await POST(makeRequest({ text: "helo" }));
  mockAuthShouldFail = false;
  assert.equal(res.status, 401);
  assert.equal(modelCallCount, 0);
});

test("empty composer text → 400 and the helper model is never called", async () => {
  modelCallCount = 0;
  const res = await POST(makeRequest({ text: "   " }));
  assert.equal(res.status, 400);
  assert.equal(modelCallCount, 0);

  const missing = await POST(makeRequest({}));
  assert.equal(missing.status, 400);
  assert.equal(modelCallCount, 0);
});

test("oversized draft → 413 and the model is never called", async () => {
  modelCallCount = 0;
  const res = await POST(makeRequest({ text: "x".repeat(6001) }));
  assert.equal(res.status, 413);
  assert.equal(modelCallCount, 0);
});

test("happy path returns the corrected text (never auto-sends anything)", async () => {
  mockModelImpl = async () => ({ text: "The bumper needs repair.", model: "m", stopReason: null });
  const res = await POST(makeRequest({ text: "the bumperr needs repar." }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.correctedText, "The bumper needs repair.");
});

test("protected strings survive: VIN, dollars, hours, part number, acronyms", async () => {
  const draft =
    "VIN 1C4SJVFP1RS133438 claim 22-04871 OEM part 68425873AC costs $1,234.56 with 2.5 hrs R&I and ADAS calib per CCC MOTOR";
  // Model keeps protected strings but fixes the tail wording.
  mockModelImpl = async () => ({
    text: "VIN 1C4SJVFP1RS133438 claim 22-04871 OEM part 68425873AC costs $1,234.56 with 2.5 hrs R&I and ADAS calibration per CCC MOTOR.",
    model: "m",
    stopReason: null,
  });
  const res = await POST(makeRequest({ text: draft }));
  const body = await res.json();
  for (const token of ["1C4SJVFP1RS133438", "22-04871", "68425873AC", "$1,234.56", "2.5 hrs", "R&I", "ADAS", "OEM", "CCC", "MOTOR"]) {
    assert.ok(body.correctedText.includes(token), `expected corrected text to keep ${token}`);
  }
});

test("model altering a protected string → original draft returned unchanged", async () => {
  const draft = "Part 68425873AC costs $1,234.56 for R&I";
  mockModelImpl = async () => ({
    // Model corrupted the part number and dropped the amount.
    text: "Part 68425873AB costs about twelve hundred dollars for R&I",
    model: "m",
    stopReason: null,
  });
  const res = await POST(makeRequest({ text: draft }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.correctedText, draft);
});

test("helper failure → 502 error, draft is never erased server-side", async () => {
  mockModelImpl = async () => {
    throw new Error("provider down");
  };
  const res = await POST(makeRequest({ text: "helo world" }));
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.error, "Couldn't check that right now.");
  assert.equal(body.correctedText, undefined);
  mockModelImpl = async () => ({ text: "corrected", model: "m", stopReason: null });
});

// ─── Runner ───────────────────────────────────────────────────────────────────

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`  ✗ ${name}`);
      console.error(error);
    }
  }
  console.log(`\n${tests.length} tests: ${tests.length - failed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
