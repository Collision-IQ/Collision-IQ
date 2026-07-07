/* eslint-disable @typescript-eslint/no-require-imports */
// Tests for src/app/api/scan-iq/route.ts
// Run from project root: node src/app/api/scan-iq/route.test.cjs

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

let mockPlan = "pro";
const mockRequireCurrentUser = async () => ({ user: { id: "user-1" }, isPlatformAdmin: false });
const mockGetCurrentEntitlements = async () => ({ plan: mockPlan });

let storedAttachments = [];
let deletedAttachments = [];
const mockSaveUploadedAttachment = async (params) => {
  const id = `att-${storedAttachments.length + 1}`;
  storedAttachments.push({ id, ...params });
  return { id, filename: params.filename, type: params.type, text: params.text };
};

let savedReports = [];
const mockSaveAnalysisReport = async (params) => {
  savedReports.push(params);
  return { id: "scan-report-1", artifactIds: params.artifactIds, createdAt: new Date().toISOString(), report: params.report };
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
  if (request === "@/lib/billing/entitlements") {
    return { getCurrentEntitlements: mockGetCurrentEntitlements };
  }
  if (request === "@/lib/attachments/extractPreviewData") {
    return {
      extractPreviewDataFromBuffer: async ({ buffer }) => ({ text: buffer.toString("utf8") }),
    };
  }
  if (request === "@/lib/uploadedAttachmentStore") {
    return {
      saveUploadedAttachment: mockSaveUploadedAttachment,
      getUploadedAttachments: async () => [],
      removeUploadedAttachments: async (ids) => {
        deletedAttachments.push(...ids);
      },
    };
  }
  if (request === "@/lib/analysisReportStore") {
    return { saveAnalysisReport: mockSaveAnalysisReport };
  }
  if (request === "@/lib/vendor/motor/motorDtcLookup") {
    return {
      lookupMotorDtcs: async () => {
        throw new Error("MOTOR down");
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

process.env.SCAN_IQ_ENABLED = "true";
process.env.MOTOR_DAAS_DTC_ENABLED = "true";

const { POST } = require(path.join(cwd, "src", "app", "api", "scan-iq", "route.ts"));

function textPayload(filename, text) {
  return {
    filename,
    mimeType: "text/plain",
    dataUrl: `data:text/plain;base64,${Buffer.from(text, "utf8").toString("base64")}`,
  };
}

const PRE_TEXT = [
  "Pre Scan 2010 Honda Civic VIN 19XFA1F51AE028415",
  "ECM - Engine Control Module",
  "P0301 Cylinder 1 Misfire ACTIVE",
  "P0420 Catalyst STORED",
].join("\n");

const POST_TEXT = [
  "Post Scan 2010 Honda Civic VIN 19XFA1F51AE028415",
  "ECM - Engine Control Module",
  "P0420 Catalyst STORED",
].join("\n");

function makeRequest(body) {
  return { json: async () => body };
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("non-Pro user cannot access Scan IQ", async () => {
  mockPlan = "free";
  const res = await POST(makeRequest({ pre: textPayload("pre.txt", PRE_TEXT), post: textPayload("post.txt", POST_TEXT) }));
  assert.equal(res.status, 403);
});

test("Pro user can upload pre/post scans and gets a saved comparison", async () => {
  mockPlan = "pro";
  savedReports = [];
  storedAttachments = [];
  const res = await POST(makeRequest({ pre: textPayload("pre.txt", PRE_TEXT), post: textPayload("post.txt", POST_TEXT) }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.reportId, "scan-report-1");
  assert.equal(body.summary.clearedCount, 1); // P0301 cleared
  assert.equal(body.summary.remainingCount, 1); // P0420 remains
  // Both files preserved as attachments and linked to the report.
  assert.equal(storedAttachments.length, 2);
  assert.equal(savedReports[0].artifactIds.length, 2);
});

test("customer summary is plain English and summary-first; technical table included", async () => {
  mockPlan = "pro";
  const res = await POST(makeRequest({ pre: textPayload("pre.txt", PRE_TEXT), post: textPayload("post.txt", POST_TEXT) }));
  const body = await res.json();
  assert.ok(body.customerSummary.startsWith("Summary:"));
  assert.ok(body.customerSummary.includes("Why it matters:"));
  assert.ok(body.technicalTable.includes("| DTC | Module |"));
});

test("MOTOR failure does not fail the scan report", async () => {
  mockPlan = "pro";
  const res = await POST(makeRequest({ pre: textPayload("pre.txt", PRE_TEXT), post: textPayload("post.txt", POST_TEXT) }));
  assert.equal(res.status, 200); // lookupMotorDtcs mock always throws
});

test("empty/unreadable scans return a safe error and never delete files", async () => {
  mockPlan = "pro";
  deletedAttachments = [];
  storedAttachments = [];
  const res = await POST(makeRequest({ pre: textPayload("pre.txt", "   "), post: textPayload("post.txt", " ") }));
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.ok(body.error.includes("files were kept"));
  assert.equal(deletedAttachments.length, 0);
  // Files were still stored (not dropped) despite the parse failure.
  assert.equal(storedAttachments.length, 2);
});

test("unsupported file type is rejected up front", async () => {
  mockPlan = "pro";
  const res = await POST(
    makeRequest({
      pre: { filename: "scan.exe", mimeType: "application/x-msdownload", dataUrl: "data:application/x-msdownload;base64,AAAA" },
      post: textPayload("post.txt", POST_TEXT),
    })
  );
  assert.equal(res.status, 400);
});

test("disabled flag → 503", async () => {
  process.env.SCAN_IQ_ENABLED = "false";
  const res = await POST(makeRequest({ pre: textPayload("pre.txt", PRE_TEXT), post: textPayload("post.txt", POST_TEXT) }));
  assert.equal(res.status, 503);
  process.env.SCAN_IQ_ENABLED = "true";
});

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
