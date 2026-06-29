/* eslint-disable @typescript-eslint/no-require-imports */
// Tests for src/app/api/fal/image/generate/route.ts
// Run from project root: node src/app/api/fal/image/generate/route.test.cjs

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

class MockFalImageConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "FalImageConfigurationError";
  }
}

class MockFalImageValidationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "FalImageValidationError";
    this.code = code;
  }
}

class MockFalImageUpstreamError extends Error {
  constructor(message, options) {
    super(message);
    this.name = "FalImageUpstreamError";
    this.statusCode = options?.statusCode;
    this.details = options?.details;
  }
}

// ─── Controllable mock implementations ───────────────────────────────────────

let mockSubmitImpl = async () => ({ requestId: "img-req-123" });
let mockStatusImpl = async () => ({ status: "IN_QUEUE", request_id: "img-req-123", queue_position: 0 });
let mockResultImpl = async () => ({
  requestId: "img-req-123",
  data: {
    images: [{ url: "https://cdn.fal.ai/generated/img.png", width: 1280, height: 720, content_type: "image/png" }],
    seed: 42,
  },
});

const mockFalLib = {
  FalImageConfigurationError: MockFalImageConfigurationError,
  FalImageValidationError: MockFalImageValidationError,
  FalImageUpstreamError: MockFalImageUpstreamError,
  submitFalImageGeneration: async (...args) => mockSubmitImpl(...args),
  getFalImageGenerationStatus: async (...args) => mockStatusImpl(...args),
  getFalImageGenerationResult: async (...args) => mockResultImpl(...args),
};

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

// ─── Module injection ────────────────────────────────────────────────────────

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
  if (request === "@/lib/ai/falImageGeneration") {
    return mockFalLib;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const origConsoleInfo = console.info;
const origConsoleError = console.error;
console.info = () => {};
console.error = () => {};

// ─── Load the route ───────────────────────────────────────────────────────────

const routePath = path.join(__dirname, "route.ts");
const route = require(routePath);
const { POST, GET } = route;

console.info = origConsoleInfo;
console.error = origConsoleError;

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makePostRequest(body) {
  return { json() { return Promise.resolve(body); } };
}

function makeGetRequest(params = {}) {
  const searchParams = new URLSearchParams(params);
  return { url: `http://localhost/api/fal/image/generate?${searchParams.toString()}` };
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

console.log("\nPOST /api/fal/image/generate");

await test("invalid JSON body → 400 INVALID_JSON", async () => {
  const req = { json() { return Promise.reject(new SyntaxError("bad json")); } };
  const res = await silentRun(() => POST(req));
  assert.equal(res._status, 400);
  assert.equal(res._body.error, "INVALID_JSON");
});

await test("missing prompt → 400 PROMPT_REQUIRED", async () => {
  mockSubmitImpl = async () => { throw new MockFalImageValidationError("prompt must be a non-empty string", "PROMPT_REQUIRED"); };
  const res = await silentRun(() => POST(makePostRequest({ numImages: 1 })));
  assert.equal(res._status, 400);
  assert.equal(res._body.error, "PROMPT_REQUIRED");
  mockSubmitImpl = async () => ({ requestId: "img-req-123" });
});

await test("empty prompt string → 400 PROMPT_REQUIRED", async () => {
  mockSubmitImpl = async () => { throw new MockFalImageValidationError("prompt must be a non-empty string", "PROMPT_REQUIRED"); };
  const res = await silentRun(() => POST(makePostRequest({ prompt: "   " })));
  assert.equal(res._status, 400);
  assert.equal(res._body.error, "PROMPT_REQUIRED");
  mockSubmitImpl = async () => ({ requestId: "img-req-123" });
});

await test("invalid imageSize enum → 400 INVALID_IMAGE_SIZE", async () => {
  mockSubmitImpl = async () => { throw new MockFalImageValidationError("imageSize must be one of: ...", "INVALID_IMAGE_SIZE"); };
  const res = await silentRun(() => POST(makePostRequest({ prompt: "A red sports car", imageSize: "widescreen_4k" })));
  assert.equal(res._status, 400);
  assert.equal(res._body.error, "INVALID_IMAGE_SIZE");
  mockSubmitImpl = async () => ({ requestId: "img-req-123" });
});

await test("invalid custom imageSize object → 400 INVALID_IMAGE_SIZE", async () => {
  mockSubmitImpl = async () => { throw new MockFalImageValidationError("imageSize dimensions must be between 256 and 2048", "INVALID_IMAGE_SIZE"); };
  const res = await silentRun(() => POST(makePostRequest({ prompt: "A red sports car", imageSize: { width: 50, height: 50 } })));
  assert.equal(res._status, 400);
  assert.equal(res._body.error, "INVALID_IMAGE_SIZE");
  mockSubmitImpl = async () => ({ requestId: "img-req-123" });
});

await test("numImages out of range → 400 INVALID_NUM_IMAGES", async () => {
  mockSubmitImpl = async () => { throw new MockFalImageValidationError("numImages must be an integer between 1 and 4", "INVALID_NUM_IMAGES"); };
  const res = await silentRun(() => POST(makePostRequest({ prompt: "A red sports car", numImages: 10 })));
  assert.equal(res._status, 400);
  assert.equal(res._body.error, "INVALID_NUM_IMAGES");
  mockSubmitImpl = async () => ({ requestId: "img-req-123" });
});

await test("missing FAL_KEY → FalImageConfigurationError → 503 FAL_NOT_CONFIGURED", async () => {
  mockSubmitImpl = async () => { throw new MockFalImageConfigurationError("FAL_KEY is not configured."); };
  const res = await silentRun(() => POST(makePostRequest({ prompt: "A red sports car" })));
  assert.equal(res._status, 503);
  assert.equal(res._body.error, "FAL_NOT_CONFIGURED");
  mockSubmitImpl = async () => ({ requestId: "img-req-123" });
});

await test("upstream fal failure → 502 FAL_IMAGE_UPSTREAM_ERROR", async () => {
  mockSubmitImpl = async () => { throw new Error("fal.ai 504 Gateway Timeout"); };
  const res = await silentRun(() => POST(makePostRequest({ prompt: "A red sports car" })));
  assert.equal(res._status, 502);
  assert.equal(res._body.error, "FAL_IMAGE_UPSTREAM_ERROR");
  mockSubmitImpl = async () => ({ requestId: "img-req-123" });
});

await test("successful submit with defaults → 202 with requestId", async () => {
  mockSubmitImpl = async () => ({ requestId: "img-abc-789" });
  const res = await silentRun(() => POST(makePostRequest({ prompt: "A red sports car with front end damage." })));
  assert.equal(res._status, 202);
  assert.equal(res._body.requestId, "img-abc-789");
  mockSubmitImpl = async () => ({ requestId: "img-req-123" });
});

await test("successful submit with all optional fields → 202", async () => {
  mockSubmitImpl = async () => ({ requestId: "img-full-001" });
  const res = await silentRun(() => POST(makePostRequest({
    prompt: "A silver sedan with crumpled front quarter panel.",
    imageSize: "landscape_16_9",
    numImages: 2,
    seed: 42,
    acceleration: "regular",
    enablePromptExpansion: true,
    enableSafetyChecker: true,
    outputFormat: "jpeg",
    syncMode: false,
  })));
  assert.equal(res._status, 202);
  assert.equal(res._body.requestId, "img-full-001");
  mockSubmitImpl = async () => ({ requestId: "img-req-123" });
});

await test("successful submit with custom imageSize object → 202", async () => {
  mockSubmitImpl = async () => ({ requestId: "img-custom-002" });
  const res = await silentRun(() => POST(makePostRequest({
    prompt: "A silver sedan with crumpled front quarter panel.",
    imageSize: { width: 1280, height: 720 },
  })));
  assert.equal(res._status, 202);
  assert.equal(res._body.requestId, "img-custom-002");
  mockSubmitImpl = async () => ({ requestId: "img-req-123" });
});

console.log("\nGET /api/fal/image/generate");

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
  const res = await silentRun(() => GET(makeGetRequest({ requestId: "img-123", action: "cancel" })));
  assert.equal(res._status, 400);
  assert.equal(res._body.error, "INVALID_ACTION");
});

await test("status action → 200 with queue status", async () => {
  mockStatusImpl = async () => ({ status: "IN_QUEUE", request_id: "img-123", queue_position: 3 });
  const res = await silentRun(() => GET(makeGetRequest({ requestId: "img-123", action: "status" })));
  assert.equal(res._status, 200);
  assert.equal(res._body.status, "IN_QUEUE");
  assert.equal(res._body.queue_position, 3);
});

await test("default action is status → 200", async () => {
  mockStatusImpl = async () => ({ status: "IN_PROGRESS", request_id: "img-123" });
  const res = await silentRun(() => GET(makeGetRequest({ requestId: "img-123" })));
  assert.equal(res._status, 200);
  assert.equal(res._body.status, "IN_PROGRESS");
});

await test("result action → 200 with image data", async () => {
  mockResultImpl = async () => ({
    requestId: "img-123",
    data: {
      images: [{ url: "https://cdn.fal.ai/img.png", width: 1280, height: 720, content_type: "image/png" }],
      seed: 99,
    },
  });
  const res = await silentRun(() => GET(makeGetRequest({ requestId: "img-123", action: "result" })));
  assert.equal(res._status, 200);
  assert.equal(res._body.requestId, "img-123");
  assert.equal(res._body.data.images[0].url, "https://cdn.fal.ai/img.png");
  assert.equal(res._body.data.seed, 99);
});

await test("upstream failure on status → 502 FAL_IMAGE_UPSTREAM_ERROR", async () => {
  mockStatusImpl = async () => { throw new Error("fal.ai 500 Internal Server Error"); };
  const res = await silentRun(() => GET(makeGetRequest({ requestId: "img-123", action: "status" })));
  assert.equal(res._status, 502);
  assert.equal(res._body.error, "FAL_IMAGE_UPSTREAM_ERROR");
  mockStatusImpl = async () => ({ status: "IN_QUEUE", request_id: "img-123", queue_position: 0 });
});

await test("FAL_NOT_CONFIGURED on status → 503", async () => {
  mockStatusImpl = async () => { throw new MockFalImageConfigurationError("FAL_KEY is not configured."); };
  const res = await silentRun(() => GET(makeGetRequest({ requestId: "img-123", action: "status" })));
  assert.equal(res._status, 503);
  assert.equal(res._body.error, "FAL_NOT_CONFIGURED");
  mockStatusImpl = async () => ({ status: "IN_QUEUE", request_id: "img-123", queue_position: 0 });
});

// ─── Summary ──────────────────────────────────────────────────────────────────

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
