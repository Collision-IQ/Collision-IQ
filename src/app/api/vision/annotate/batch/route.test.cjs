/* eslint-disable @typescript-eslint/no-require-imports */
// Tests for src/app/api/vision/annotate/batch/route.ts
// Run from project root: node src/app/api/vision/annotate/batch/route.test.cjs

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

const CALLOUT_DISCLAIMER = "AI visual aid — visible damage annotation only. Not a forensic measurement.";
const HEATMAP_DISCLAIMER = "AI visual aid — visible damage heat map only. Not a forensic measurement.";

const sampleAnalysis = {
  summary: "Visible left-side door damage.",
  zones: [{ label: "Rear door dent", description: "dent", confidence: "high", severity: "high", approximateLocation: "rear door", evidenceLimits: "visible only" }],
  notEstablished: ["Hidden intrusion"],
  recommendedNextPhotos: ["Close-up"],
};

let mockAnalyzeImpl = async () => sampleAnalysis;
let mockRenderImpl = async () => Buffer.from("fake-png-bytes");
let mockPutImpl = async (pathname) => ({ url: `https://blob.example/${pathname}` });
let mockGetAttachmentsImpl = async (ids) =>
  ids.map((id) => ({ id, filename: `${id}.jpg`, imageDataUrl: "data:image/jpeg;base64,AAAA" }));
let mockAuthShouldFail = false;

const mockRequireCurrentUser = async () => {
  if (mockAuthShouldFail) throw new MockUnauthorizedError();
  return { user: { id: "u1" }, isPlatformAdmin: false };
};

function makeNextResponseMock() {
  return {
    json(body, init) {
      const status = (init && init.status) != null ? init.status : 200;
      return { _status: status, _body: body, status };
    },
  };
}

const originalLoad = Module._load;
Module._load = function interceptLoad(request, parent, isMain) {
  if (request === "next/server") return { NextResponse: makeNextResponseMock() };
  if (request === "@/lib/auth/require-current-user") {
    return { requireCurrentUser: mockRequireCurrentUser, UnauthorizedError: MockUnauthorizedError };
  }
  if (request === "@/lib/uploadedAttachmentStore") {
    return { getUploadedAttachments: async (...args) => mockGetAttachmentsImpl(...args) };
  }
  if (request === "@/lib/ai/visionDamageAnnotation") {
    return {
      analyzeDamagePhoto: async (...args) => mockAnalyzeImpl(...args),
      disclaimerForAnnotationStyle: (style) => (style === "heatmap" ? HEATMAP_DISCLAIMER : CALLOUT_DISCLAIMER),
      VISION_AID_DISCLAIMER: "generic",
      FalConfigurationError: MockFalConfigurationError,
    };
  }
  if (request === "@/lib/ai/renderDamageOverlay") {
    return { renderDamageOverlay: async (...args) => mockRenderImpl(...args) };
  }
  if (request === "@vercel/blob") return { put: async (...args) => mockPutImpl(...args) };
  return originalLoad.call(this, request, parent, isMain);
};

console.info = () => {};
console.warn = () => {};
console.error = () => {};
const { POST } = require(path.join(__dirname, "route.ts"));

function makePostRequest(body) {
  return { json() { return Promise.resolve(body); } };
}
function resetMocks() {
  mockAuthShouldFail = false;
  mockAnalyzeImpl = async () => sampleAnalysis;
  mockRenderImpl = async () => Buffer.from("fake-png-bytes");
  mockPutImpl = async (pathname) => ({ url: `https://blob.example/${pathname}` });
  mockGetAttachmentsImpl = async (ids) =>
    ids.map((id) => ({ id, filename: `${id}.jpg`, imageDataUrl: "data:image/jpeg;base64,AAAA" }));
}

let passed = 0;
let failed = 0;
const failures = [];
async function test(name, fn) {
  resetMocks();
  try {
    await fn();
    console.log = origLog;
    console.log(`  ✓ ${name}`);
    console.log = () => {};
    passed++;
  } catch (err) {
    console.log = origLog;
    console.error(`  ✗ ${name}\n    ${err.message}`);
    failures.push({ name, err });
    console.log = () => {};
    failed++;
  }
}
const origLog = console.log;
console.log = () => {};

(async () => {
  origLog("\nPOST /api/vision/annotate/batch");

  await test("unauthorized → 401", async () => {
    mockAuthShouldFail = true;
    const res = await POST(makePostRequest({ attachmentIds: ["a"] }));
    assert.equal(res._status, 401);
  });

  await test("no attachmentIds → 400 ATTACHMENT_IDS_REQUIRED", async () => {
    const res = await POST(makePostRequest({ attachmentIds: [] }));
    assert.equal(res._status, 400);
    assert.equal(res._body.error, "ATTACHMENT_IDS_REQUIRED");
  });

  await test("more than 10 photos → 200 TOO_MANY_IMAGES message", async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `att-${i}`);
    const res = await POST(makePostRequest({ attachmentIds: ids }));
    assert.equal(res._status, 200);
    assert.equal(res._body.ok, false);
    assert.equal(res._body.error, "TOO_MANY_IMAGES");
    assert.match(res._body.message, /12 photos/);
  });

  await test("success → one annotated result per photo with data URL", async () => {
    const res = await POST(makePostRequest({ attachmentIds: ["a", "b"], annotationStyle: "heatmap" }));
    assert.equal(res._status, 200);
    assert.equal(res._body.ok, true);
    assert.equal(res._body.annotationStyle, "heatmap");
    assert.equal(res._body.disclaimer, HEATMAP_DISCLAIMER);
    assert.equal(res._body.results.length, 2);
    for (const r of res._body.results) {
      assert.equal(r.ok, true);
      assert.ok(r.annotatedImageDataUrl.startsWith("data:image/png;base64,"));
      assert.ok(r.annotatedImageUrl.startsWith("https://blob.example/"));
    }
  });

  await test("missing image attachment is reported per-image, batch still ok", async () => {
    mockGetAttachmentsImpl = async () => [{ id: "a", filename: "a.jpg", imageDataUrl: "data:image/jpeg;base64,AAAA" }];
    const res = await POST(makePostRequest({ attachmentIds: ["a", "missing"] }));
    assert.equal(res._status, 200);
    assert.equal(res._body.ok, true);
    const bad = res._body.results.find((r) => r.attachmentId === "missing");
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "ATTACHMENT_NOT_FOUND");
  });

  await test("FAL not configured → 503", async () => {
    mockAnalyzeImpl = async () => { throw new MockFalConfigurationError("no key"); };
    const res = await POST(makePostRequest({ attachmentIds: ["a"] }));
    assert.equal(res._status, 503);
    assert.equal(res._body.error, "FAL_NOT_CONFIGURED");
  });

  console.log = origLog;
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const { name, err } of failures) console.error(`\nFAILED: ${name}\n${err.stack || err.message}`);
    process.exit(1);
  }
})();
