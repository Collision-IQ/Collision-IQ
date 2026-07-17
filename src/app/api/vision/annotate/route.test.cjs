/* eslint-disable @typescript-eslint/no-require-imports */
// Tests for src/app/api/vision/annotate/route.ts
// Run from project root: node src/app/api/vision/annotate/route.test.cjs

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

class MockVisionAnnotationValidationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "VisionAnnotationValidationError";
    this.code = code;
  }
}

class MockVisionAnnotationParseError extends Error {
  constructor(message) {
    super(message);
    this.name = "VisionAnnotationParseError";
  }
}

const DISCLAIMER =
  "AI-generated visual aid. Not a forensic reconstruction. Not a substitute for inspection, measurement, scan, calibration, OEM procedure, or repair documentation.";
const CALLOUT_DISCLAIMER =
  "AI visual aid — visible damage annotation only. Not a forensic measurement.";
const HEATMAP_DISCLAIMER =
  "AI visual aid — visible damage heat map only. Not a forensic measurement.";
function mockDisclaimerForStyle(style) {
  return style === "heatmap" ? HEATMAP_DISCLAIMER : CALLOUT_DISCLAIMER;
}

// ─── Controllable mock implementations ────────────────────────────────────────

const sampleAnalysis = {
  summary: "Front bumper and left fender show impact damage.",
  zones: [
    {
      label: "Front bumper cover",
      description: "Cracked and pushed in",
      confidence: "high",
      severity: "high",
      approximateLocation: "Lower front center",
      evidenceLimits: "Underlying reinforcement not visible",
      boundingBox: { x: 0.3, y: 0.55, width: 0.4, height: 0.25 },
    },
    {
      label: "Left fender",
      description: "Surface scuffing",
      confidence: "medium",
      severity: "low",
      approximateLocation: "Left front quarter",
      evidenceLimits: "Cannot confirm paint depth",
    },
  ],
  notEstablished: ["Frame/structural integrity", "Airbag deployment status"],
  recommendedNextPhotos: ["Close-up of bumper bracket", "Engine bay photo"],
};

let mockAnalyzeImpl = async () => sampleAnalysis;
let mockRenderImpl = async () => Buffer.from("fake-png-bytes");
let mockPutImpl = async (pathname) => ({ url: `https://blob.example/${pathname}` });
let mockGetAttachmentsImpl = async () => [
  { id: "att-1", filename: "damage.jpg", type: "image/jpeg", text: "", imageDataUrl: "data:image/jpeg;base64,AAAA" },
];

let mockAuthShouldFail = false;
const mockRequireCurrentUser = async () => {
  if (mockAuthShouldFail) throw new MockUnauthorizedError();
  return { user: { id: "test-user-id" }, isPlatformAdmin: false };
};

function makeNextResponseMock() {
  return {
    json(body, init) {
      const status = (init && init.status) != null ? init.status : 200;
      return { _status: status, _body: body, status, async json() { return body; } };
    },
  };
}

// ─── Module injection ─────────────────────────────────────────────────────────

const originalLoad = Module._load;
Module._load = function interceptLoad(request, parent, isMain) {
  if (request === "next/server") {
    return { NextResponse: makeNextResponseMock() };
  }
  if (request === "@/lib/auth/require-current-user") {
    return { requireCurrentUser: mockRequireCurrentUser, UnauthorizedError: MockUnauthorizedError };
  }
  if (request === "@/lib/uploadedAttachmentStore") {
    return { getUploadedAttachments: async (...args) => mockGetAttachmentsImpl(...args) };
  }
  if (request === "@/lib/ai/visionDamageAnnotation") {
    return {
      analyzeDamagePhoto: async (...args) => mockAnalyzeImpl(...args),
      disclaimerForAnnotationStyle: mockDisclaimerForStyle,
      VISION_AID_DISCLAIMER: DISCLAIMER,
      FalConfigurationError: MockFalConfigurationError,
      VisionAnnotationValidationError: MockVisionAnnotationValidationError,
      VisionAnnotationParseError: MockVisionAnnotationParseError,
    };
  }
  if (request === "@/lib/ai/renderDamageOverlay") {
    return { renderDamageOverlay: async (...args) => mockRenderImpl(...args) };
  }
  if (request === "@/lib/ai/damageImageNormalization") {
    return { normalizeDamageImage: async (source) => ({ buffer: Buffer.isBuffer(source) ? source : Buffer.from("source"), dataUrl: "data:image/png;base64,c291cmNl", sourceHash: "a".repeat(64), naturalWidth: 100, naturalHeight: 80, originalOrientation: 1, normalizedOrientation: 1 }) };
  }
  if (request === "@/lib/ai/damageSegmentation") {
    return { DAMAGE_SEGMENTATION_MODEL: "fal-ai/sam-3-1/image-rle", segmentVisibleDamage: async () => ({ masks: [], rejected: [] }) };
  }
  if (request === "@vercel/blob") {
    return { put: async (...args) => mockPutImpl(...args) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const origConsoleInfo = console.info;
const origConsoleWarn = console.warn;
const origConsoleError = console.error;
console.info = () => {};
console.warn = () => {};
console.error = () => {};

const routePath = path.join(__dirname, "route.ts");
const { POST } = require(routePath);

console.info = origConsoleInfo;
console.warn = origConsoleWarn;
console.error = origConsoleError;

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makePostRequest(body) {
  return { json() { return Promise.resolve(body); } };
}

function resetMocks() {
  mockAuthShouldFail = false;
  mockAnalyzeImpl = async () => sampleAnalysis;
  mockRenderImpl = async () => Buffer.from("fake-png-bytes");
  mockPutImpl = async (pathname) => ({ url: `https://blob.example/${pathname}` });
  mockGetAttachmentsImpl = async () => [
    { id: "att-1", filename: "damage.jpg", type: "image/jpeg", text: "", imageDataUrl: "data:image/jpeg;base64,AAAA" },
  ];
}

function silentRun(fn) {
  const prevInfo = console.info, prevWarn = console.warn, prevError = console.error;
  console.info = () => {}; console.warn = () => {}; console.error = () => {};
  return fn().finally(() => { console.info = prevInfo; console.warn = prevWarn; console.error = prevError; });
}

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  resetMocks();
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

console.log("\nPOST /api/vision/annotate");

await test("invalid JSON body → 400 INVALID_JSON", async () => {
  const req = { json() { return Promise.reject(new SyntaxError("bad json")); } };
  const res = await silentRun(() => POST(req));
  assert.equal(res._status, 400);
  assert.equal(res._body.error, "INVALID_JSON");
});

await test("unauthorized → 401", async () => {
  mockAuthShouldFail = true;
  const res = await silentRun(() => POST(makePostRequest({ imageUrl: "https://x/y.jpg" })));
  assert.equal(res._status, 401);
});

await test("no image source → 400 IMAGE_REQUIRED", async () => {
  const res = await silentRun(() => POST(makePostRequest({ prompt: "look" })));
  assert.equal(res._status, 400);
  assert.equal(res._body.error, "IMAGE_REQUIRED");
});

await test("attachment not found → 404 ATTACHMENT_NOT_FOUND", async () => {
  mockGetAttachmentsImpl = async () => [];
  const res = await silentRun(() => POST(makePostRequest({ attachmentId: "missing" })));
  assert.equal(res._status, 404);
  assert.equal(res._body.error, "ATTACHMENT_NOT_FOUND");
});

await test("attachment with no image data → 400 ATTACHMENT_NOT_IMAGE", async () => {
  mockGetAttachmentsImpl = async () => [
    { id: "att-1", filename: "doc.pdf", type: "application/pdf", text: "x", imageDataUrl: undefined },
  ];
  const res = await silentRun(() => POST(makePostRequest({ attachmentId: "att-1" })));
  assert.equal(res._status, 400);
  assert.equal(res._body.error, "ATTACHMENT_NOT_IMAGE");
});

await test("FAL not configured → 503 FAL_NOT_CONFIGURED", async () => {
  mockAnalyzeImpl = async () => { throw new MockFalConfigurationError("FAL_KEY is not configured."); };
  const res = await silentRun(() => POST(makePostRequest({ imageUrl: "https://x/y.jpg" })));
  assert.equal(res._status, 503);
  assert.equal(res._body.error, "FAL_NOT_CONFIGURED");
});

await test("validation error from analyze → 400 with code", async () => {
  mockAnalyzeImpl = async () => { throw new MockVisionAnnotationValidationError("too many", "TOO_MANY_IMAGES"); };
  const res = await silentRun(() => POST(makePostRequest({ imageUrl: "https://x/y.jpg" })));
  assert.equal(res._status, 400);
  assert.equal(res._body.error, "TOO_MANY_IMAGES");
});

await test("parse/upstream failure → 502 VISION_ANNOTATE_UPSTREAM_ERROR", async () => {
  mockAnalyzeImpl = async () => { throw new MockVisionAnnotationParseError("bad json from model"); };
  const res = await silentRun(() => POST(makePostRequest({ imageUrl: "https://x/y.jpg" })));
  assert.equal(res._status, 502);
  assert.equal(res._body.error, "VISION_ANNOTATE_UPSTREAM_ERROR");
});

await test("success with imageUrl → 200 with artifact + zones + disclaimer", async () => {
  const res = await silentRun(() => POST(makePostRequest({ imageUrl: "https://x/y.jpg" })));
  assert.equal(res._status, 200);
  assert.equal(res._body.ok, true);
  assert.equal(res._body.summary, sampleAnalysis.summary);
  assert.equal(res._body.zones.length, 2);
  // Default style is callout; disclaimer is the style-specific label.
  assert.equal(res._body.annotationStyle, "callout");
  assert.equal(res._body.disclaimer, CALLOUT_DISCLAIMER);
  assert.ok(res._body.annotatedImageUrl.startsWith("https://blob.example/"));
  assert.ok(res._body.annotatedImageDataUrl.startsWith("data:image/png;base64,"));
  assert.deepEqual(res._body.notEstablished, sampleAnalysis.notEstablished);
  assert.deepEqual(res._body.recommendedNextPhotos, sampleAnalysis.recommendedNextPhotos);
  assert.equal(res._body.warnings, undefined);
});

await test("annotationStyle heatmap → passed to analyze + heatmap disclaimer", async () => {
  let analyzedWith = null;
  let renderedWith = null;
  mockAnalyzeImpl = async (arg) => { analyzedWith = arg; return sampleAnalysis; };
  mockRenderImpl = async (arg) => { renderedWith = arg; return Buffer.from("png"); };
  const res = await silentRun(() =>
    POST(makePostRequest({ imageUrl: "https://x/y.jpg", annotationStyle: "heatmap" }))
  );
  assert.equal(res._status, 200);
  assert.equal(res._body.annotationStyle, "heatmap");
  assert.equal(res._body.disclaimer, HEATMAP_DISCLAIMER);
  assert.equal(analyzedWith.annotationStyle, "heatmap");
  assert.equal(renderedWith.annotationStyle, "heatmap");
});

await test("unknown annotationStyle falls back to callout", async () => {
  const res = await silentRun(() =>
    POST(makePostRequest({ imageUrl: "https://x/y.jpg", annotationStyle: "bogus" }))
  );
  assert.equal(res._status, 200);
  assert.equal(res._body.annotationStyle, "callout");
});

await test("imageDataUrl input is decoded to a Buffer for the renderer", async () => {
  let renderedWith = null;
  mockRenderImpl = async (arg) => { renderedWith = arg; return Buffer.from("png"); };
  const res = await silentRun(() =>
    POST(makePostRequest({ imageDataUrl: "data:image/png;base64,AAAA" }))
  );
  assert.equal(res._status, 200);
  assert.ok(Buffer.isBuffer(renderedWith.imageSource));
});

await test("object vehicleContext is flattened into the vision prompt", async () => {
  let analyzedWith = null;
  mockAnalyzeImpl = async (arg) => { analyzedWith = arg; return sampleAnalysis; };
  await silentRun(() =>
    POST(
      makePostRequest({
        imageUrl: "https://x/y.jpg",
        vehicleContext: { year: "2015", make: "Jeep", model: "Cherokee", side: "left" },
      })
    )
  );
  assert.match(analyzedWith.vehicleContext, /2015/);
  assert.match(analyzedWith.vehicleContext, /Jeep/);
  assert.match(analyzedWith.vehicleContext, /Cherokee/);
});

await test("success with attachmentId → 200", async () => {
  let renderedWith = null;
  mockRenderImpl = async (arg) => { renderedWith = arg; return Buffer.from("png"); };
  const res = await silentRun(() => POST(makePostRequest({ attachmentId: "att-1" })));
  assert.equal(res._status, 200);
  assert.equal(res._body.ok, true);
  // The data URL should have been decoded to a Buffer for the renderer.
  assert.ok(Buffer.isBuffer(renderedWith.imageSource));
});

await test("artifact save failure → 200, annotatedImageUrl null, warning set", async () => {
  mockPutImpl = async () => { throw new Error("blob token missing"); };
  const res = await silentRun(() => POST(makePostRequest({ imageUrl: "https://x/y.jpg" })));
  assert.equal(res._status, 200);
  assert.equal(res._body.ok, true);
  assert.equal(res._body.annotatedImageUrl, null);
  assert.ok(Array.isArray(res._body.warnings));
  assert.ok(res._body.warnings.includes("ARTIFACT_SAVE_FAILED"));
});

// ─── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const { name, err } of failures) {
    console.error(`\nFAILED: ${name}\n${err.stack || err.message}`);
  }
  process.exit(1);
}

})();
