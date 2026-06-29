/* eslint-disable @typescript-eslint/no-require-imports */
// Focused route tests for src/app/api/fal/vision/route.ts
// Run from project root: node src/app/api/fal/vision/route.test.cjs

"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const fs = require("node:fs");
const ts = require("typescript");

// ─── TypeScript transpiler ───────────────────────────────────────────────────

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

// ─── Mock error classes ───────────────────────────────────────────────────────

class MockUnauthorizedError extends Error {
  constructor(message = "Authentication is required.") {
    super(message);
    this.name = "UnauthorizedError";
    this.status = 401;
  }
}

class MockFalConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "FalConfigurationError";
  }
}

class MockFalValidationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "FalValidationError";
    this.code = code;
  }
}

class MockFalUpstreamError extends Error {
  constructor(message, options) {
    super(message);
    this.name = "FalUpstreamError";
    this.statusCode = options?.statusCode;
    this.details = options?.details;
  }
}

// ─── Controllable mock implementations ───────────────────────────────────────

let mockSubmitImpl = async () => ({ requestId: "req-test-123" });
let mockStatusImpl = async () => ({ status: "IN_QUEUE", request_id: "req-test-123", queue_position: 0 });
let mockResultImpl = async () => ({ requestId: "req-test-123", data: { output: "A red car with damage to the front bumper." } });

const mockFalLib = {
  FalConfigurationError: MockFalConfigurationError,
  FalValidationError: MockFalValidationError,
  FalUpstreamError: MockFalUpstreamError,
  submitFalOpenrouterVision: async (...args) => mockSubmitImpl(...args),
  getFalOpenrouterVisionStatus: async (...args) => mockStatusImpl(...args),
  getFalOpenrouterVisionResult: async (...args) => mockResultImpl(...args),
};

// Mock NextResponse: captures status + body so tests can inspect them
function makeNextResponseMock() {
  return {
    json(body, init) {
      const status = (init && init.status) != null ? init.status : 200;
      return {
        _status: status,
        _body: body,
        status,
        async json() { return body; },
      };
    },
  };
}

let mockAuthShouldFail = false;
const mockRequireCurrentUser = async () => {
  if (mockAuthShouldFail) throw new MockUnauthorizedError();
  return { user: { id: "test-user-id" }, isPlatformAdmin: false };
};

// ─── Module injection (must happen before route is loaded) ───────────────────

const originalLoad = Module._load;
Module._load = function interceptLoad(request, parent, isMain) {
  if (request === "next/server") {
    return { NextResponse: makeNextResponseMock() };
  }
  if (request === "@/lib/auth/require-current-user") {
    return {
      requireCurrentUser: mockRequireCurrentUser,
      UnauthorizedError: MockUnauthorizedError,
    };
  }
  if (request === "@/lib/ai/falOpenrouterVision") {
    return mockFalLib;
  }
  return originalLoad.call(this, request, parent, isMain);
};

// Suppress route logging during tests
const origConsoleInfo = console.info;
const origConsoleError = console.error;
console.info = () => {};
console.error = () => {};

// ─── Load the route ───────────────────────────────────────────────────────────

const routePath = path.join(__dirname, "route.ts");
const route = require(routePath);
const { POST, GET } = route;

// Restore console after load-time logging
console.info = origConsoleInfo;
console.error = origConsoleError;

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makePostRequest(body) {
  return {
    json() { return Promise.resolve(body); },
  };
}

function makeGetRequest(params = {}) {
  const searchParams = new URLSearchParams(params);
  return { url: `http://localhost/api/fal/vision?${searchParams.toString()}` };
}

function silentRun(fn) {
  const prevInfo = console.info;
  const prevError = console.error;
  console.info = () => {};
  console.error = () => {};
  return fn().finally(() => {
    console.info = prevInfo;
    console.error = prevError;
  });
}

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failures.push({ name, err });
    failed++;
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

(async () => {

console.log("\nPOST /api/fal/vision");

await test("invalid JSON body → 400 INVALID_JSON", async () => {
  const req = { json() { return Promise.reject(new SyntaxError("bad json")); } };
  const res = await silentRun(() => POST(req));
  assert.equal(res._status, 400);
  assert.equal(res._body.error, "INVALID_JSON");
});

await test("missing prompt → 400 PROMPT_REQUIRED", async () => {
  const res = await silentRun(() => POST(makePostRequest({ imageUrls: ["data:image/png;base64,abc"] })));
  assert.equal(res._status, 400);
  assert.equal(res._body.error, "PROMPT_REQUIRED");
});

await test("empty prompt string → 400 PROMPT_REQUIRED", async () => {
  const res = await silentRun(() => POST(makePostRequest({ prompt: "   ", imageUrls: ["data:image/png;base64,abc"] })));
  assert.equal(res._status, 400);
  assert.equal(res._body.error, "PROMPT_REQUIRED");
});

await test("no imageUrls → 400 IMAGE_URLS_REQUIRED", async () => {
  const res = await silentRun(() => POST(makePostRequest({ prompt: "Describe this image." })));
  assert.equal(res._status, 400);
  assert.equal(res._body.error, "IMAGE_URLS_REQUIRED");
});

await test("empty imageUrls array → 400 IMAGE_URLS_REQUIRED", async () => {
  const res = await silentRun(() => POST(makePostRequest({ prompt: "Describe this image.", imageUrls: [] })));
  assert.equal(res._status, 400);
  assert.equal(res._body.error, "IMAGE_URLS_REQUIRED");
});

await test("malformed imageUrls (non-string items only) → 400 IMAGE_URLS_REQUIRED", async () => {
  const res = await silentRun(() => POST(makePostRequest({
    prompt: "Describe this image.",
    imageUrls: [null, 42, {}, true],
  })));
  assert.equal(res._status, 400);
  assert.equal(res._body.error, "IMAGE_URLS_REQUIRED");
});

await test("imageUrls as non-array (string) → 400 IMAGE_URLS_REQUIRED", async () => {
  const res = await silentRun(() => POST(makePostRequest({
    prompt: "Describe this image.",
    imageUrls: "http://example.com/photo.jpg",
  })));
  assert.equal(res._status, 400);
  assert.equal(res._body.error, "IMAGE_URLS_REQUIRED");
});

await test("missing FAL_KEY → FalConfigurationError → 503 FAL_NOT_CONFIGURED", async () => {
  mockSubmitImpl = async () => { throw new MockFalConfigurationError("FAL_KEY is not configured."); };
  const res = await silentRun(() => POST(makePostRequest({
    prompt: "Describe this image.",
    imageUrls: ["data:image/jpeg;base64,/9j/valid"],
  })));
  assert.equal(res._status, 503);
  assert.equal(res._body.error, "FAL_NOT_CONFIGURED");
  mockSubmitImpl = async () => ({ requestId: "req-test-123" });
});

await test("upstream fal failure → 502 FAL_VISION_UPSTREAM_ERROR", async () => {
  mockSubmitImpl = async () => { throw new Error("fal.ai 504 Gateway Timeout"); };
  const res = await silentRun(() => POST(makePostRequest({
    prompt: "Describe this image.",
    imageUrls: ["data:image/jpeg;base64,/9j/valid"],
  })));
  assert.equal(res._status, 502);
  assert.equal(res._body.error, "FAL_VISION_UPSTREAM_ERROR");
  mockSubmitImpl = async () => ({ requestId: "req-test-123" });
});

await test("successful submit → 202 with requestId", async () => {
  mockSubmitImpl = async () => ({ requestId: "req-abc-789" });
  const res = await silentRun(() => POST(makePostRequest({
    prompt: "Describe the damage visible in this photo.",
    imageUrls: ["data:image/jpeg;base64,/9j/validimage"],
  })));
  assert.equal(res._status, 202);
  assert.equal(res._body.requestId, "req-abc-789");
  mockSubmitImpl = async () => ({ requestId: "req-test-123" });
});

await test("successful submit with optional fields → 202", async () => {
  mockSubmitImpl = async () => ({ requestId: "req-opt-001" });
  const res = await silentRun(() => POST(makePostRequest({
    prompt: "Compare these two images.",
    imageUrls: ["data:image/jpeg;base64,img1", "data:image/jpeg;base64,img2"],
    systemPrompt: "You are a collision damage expert.",
    model: "anthropic/claude-opus-4-8",
    reasoning: true,
    temperature: 0.3,
    maxTokens: 1024,
  })));
  assert.equal(res._status, 202);
  assert.equal(res._body.requestId, "req-opt-001");
  mockSubmitImpl = async () => ({ requestId: "req-test-123" });
});

console.log("\nGET /api/fal/vision");

await test("missing requestId → 400 REQUEST_ID_REQUIRED", async () => {
  const res = await silentRun(() => GET(makeGetRequest()));
  assert.equal(res._status, 400);
  assert.equal(res._body.error, "REQUEST_ID_REQUIRED");
});

await test("empty requestId → 400 REQUEST_ID_REQUIRED", async () => {
  const res = await silentRun(() => GET(makeGetRequest({ requestId: "  " })));
  assert.equal(res._status, 400);
  assert.equal(res._body.error, "REQUEST_ID_REQUIRED");
});

await test("invalid action → 400 INVALID_ACTION", async () => {
  const res = await silentRun(() => GET(makeGetRequest({ requestId: "req-123", action: "cancel" })));
  assert.equal(res._status, 400);
  assert.equal(res._body.error, "INVALID_ACTION");
});

await test("status action → 200 with queue status", async () => {
  mockStatusImpl = async () => ({ status: "IN_QUEUE", request_id: "req-123", queue_position: 2 });
  const res = await silentRun(() => GET(makeGetRequest({ requestId: "req-123", action: "status" })));
  assert.equal(res._status, 200);
  assert.equal(res._body.status, "IN_QUEUE");
  assert.equal(res._body.queue_position, 2);
});

await test("default action is status → 200", async () => {
  mockStatusImpl = async () => ({ status: "IN_PROGRESS", request_id: "req-123" });
  const res = await silentRun(() => GET(makeGetRequest({ requestId: "req-123" })));
  assert.equal(res._status, 200);
  assert.equal(res._body.status, "IN_PROGRESS");
});

await test("result action → 200 with result data", async () => {
  mockResultImpl = async () => ({
    requestId: "req-123",
    data: { output: "Front bumper shows significant impact damage.", usage: { cost: 0.002 } },
  });
  const res = await silentRun(() => GET(makeGetRequest({ requestId: "req-123", action: "result" })));
  assert.equal(res._status, 200);
  assert.equal(res._body.requestId, "req-123");
  assert.equal(res._body.data.output, "Front bumper shows significant impact damage.");
});

await test("upstream failure on status → 502 FAL_VISION_UPSTREAM_ERROR", async () => {
  mockStatusImpl = async () => { throw new Error("fal.ai 500 Internal Server Error"); };
  const res = await silentRun(() => GET(makeGetRequest({ requestId: "req-123", action: "status" })));
  assert.equal(res._status, 502);
  assert.equal(res._body.error, "FAL_VISION_UPSTREAM_ERROR");
  mockStatusImpl = async () => ({ status: "IN_QUEUE", request_id: "req-123", queue_position: 0 });
});

await test("FAL_NOT_CONFIGURED on status → 503", async () => {
  mockStatusImpl = async () => { throw new MockFalConfigurationError("FAL_KEY is not configured."); };
  const res = await silentRun(() => GET(makeGetRequest({ requestId: "req-123", action: "status" })));
  assert.equal(res._status, 503);
  assert.equal(res._body.error, "FAL_NOT_CONFIGURED");
  mockStatusImpl = async () => ({ status: "IN_QUEUE", request_id: "req-123", queue_position: 0 });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  for (const { name, err } of failures) {
    console.error(`FAILED: ${name}`);
    console.error(err.stack ?? err.message);
  }
  process.exit(1);
}

})().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
