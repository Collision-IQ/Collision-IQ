/* eslint-disable @typescript-eslint/no-require-imports */
// Tests for src/app/api/integrations/ccc-secure-share/intake/route.ts
// Run from project root: node src/app/api/integrations/ccc-secure-share/intake/route.test.cjs

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
const mockRequireCurrentUser = async () => ({ user: { id: "user-1" }, isPlatformAdmin: mockPlan === "admin" });
const mockGetCurrentEntitlements = async () => ({ plan: mockPlan, isPlatformAdmin: mockPlan === "admin" });

const SAMPLE_DETAIL = {
  id: "evt-1",
  receivedAt: "2026-07-06T12:00:00.000Z",
  environment: "sandbox",
  requestKind: "estimate",
  rqUid: "rq-1",
  appId: "app-1",
  trigger: "estimate_share",
  bodyLength: 1000,
  contentType: "application/xml",
  sourceIp: null,
  signaturePresent: true,
  secretMatched: true,
  duplicate: false,
  normalizationStatus: "normalized",
  normalizedLineItemCount: 2,
  vehicle: { year: 2010, make: "Honda", model: "Civic", vinTail: "8415" },
  jurisdiction: { stateCode: "PA", source: "owner_address", confidence: "high" },
  warningCount: 0,
  normalizedHeader: {
    identifiers: {
      workfileId: "WF-123",
      estimateId: "EST-456",
      estimateVersion: "E01",
      supplementNumber: "S01",
      claimNumberRedacted: "22-***71",
    },
    vehicle: { year: 2010, make: "Honda", model: "Civic", trim: "LX", mileage: 88000, vinTail: "8415" },
    parties: {
      insurer: { name: "Root Insurance" },
      repairFacility: { name: "Conestoga Collision", address1: "1 Main St", city: "Lancaster", state: "PA", zip: "17601" },
      owner: { name: "J. Driver" },
    },
    totals: { grossTotal: 4321.09 },
  },
  jurisdictionEvidence: {},
  jurisdictionResolution: {},
  totals: { grossTotal: 4321.09 },
  lineItemPreview: [
    { lineNumber: "1", section: "FRT BUMPER", operation: "Repl", description: "Bumper cover", laborHours: 2.5, extendedAmount: 512.34, parseWarnings: [] },
    { lineNumber: "2", section: "FRT BUMPER", operation: "Rpr", description: "Absorber", laborHours: 1.0, parseWarnings: [] },
  ],
  parseWarnings: [],
  normalizationWarnings: [],
  aiSafeContextPreview: null,
  evidenceBoundaries: { linePresence: "", citationGap: "", authority: "" },
};

let savedReports = [];
const mockSaveAnalysisReport = async (params) => {
  savedReports.push(params);
  return { id: "report-1", artifactIds: [], createdAt: new Date().toISOString(), report: params.report };
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
  if (request === "@/lib/ccc/secureSharePreview") {
    return {
      listCccSecureSharePreviewEvents: async () => [
        { id: "evt-1", normalizationStatus: "normalized", receivedAt: SAMPLE_DETAIL.receivedAt, vehicle: SAMPLE_DETAIL.vehicle, jurisdiction: SAMPLE_DETAIL.jurisdiction, normalizedLineItemCount: 2 },
        { id: "evt-2", normalizationStatus: null },
      ],
      getCccSecureSharePreviewEvent: async (id) => (id === "evt-1" ? SAMPLE_DETAIL : null),
    };
  }
  if (request === "@/lib/analysisReportStore") {
    return { saveAnalysisReport: mockSaveAnalysisReport };
  }
  return originalLoad.call(this, request, parent, isMain);
};

process.env.CCC_SECURE_SHARE_PIPELINE_ENABLED = "true";

const { GET, POST } = require(path.join(
  cwd, "src", "app", "api", "integrations", "ccc-secure-share", "intake", "route.ts"
));

function makeRequest(body) {
  return { json: async () => body };
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("non-Pro user cannot access CCC Secure Share Import", async () => {
  mockPlan = "free";
  const list = await GET();
  assert.equal(list.status, 403);
  const imported = await POST(makeRequest({ eventId: "evt-1" }));
  assert.equal(imported.status, 403);

  mockPlan = "starter";
  assert.equal((await GET()).status, 403);
});

test("Pro and Admin users can access CCC Secure Share Import", async () => {
  mockPlan = "pro";
  const proList = await GET();
  assert.equal(proList.status, 200);
  const proBody = await proList.json();
  // Only normalized events are importable.
  assert.equal(proBody.events.length, 1);

  mockPlan = "admin";
  assert.equal((await GET()).status, 200);
});

test("CCC estimate payload normalizes into Collision IQ review input", async () => {
  mockPlan = "pro";
  savedReports = [];
  const res = await POST(makeRequest({ eventId: "evt-1" }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.reportId, "report-1");
  assert.equal(body.import.sourceSystem, "CCC Secure Share");
  assert.equal(body.import.sourceApplication, "CCC ONE");

  // The saved report is reviewable: estimate-style text + history metadata.
  const saved = savedReports[0].report;
  assert.ok(saved.sourceEstimateText.includes("CCC SECURE SHARE IMPORT"));
  assert.ok(saved.sourceEstimateText.includes("Bumper cover"));
  assert.equal(saved.vehicle.make, "Honda");
  assert.equal(savedReports[0].ownerUserId, "user-1");
});

test("missing photos do not fail import and are labeled", async () => {
  mockPlan = "pro";
  const res = await POST(makeRequest({ eventId: "evt-1" }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.import.attachments.photosAvailable, false);
  assert.equal(body.import.attachments.photoCount, 0);
  assert.ok(body.import.attachments.unavailableReason.includes("not provided by CCC Secure Share"));
});

test("source metadata is preserved (workfile, version, supplement, receivedAt)", async () => {
  mockPlan = "pro";
  const res = await POST(makeRequest({ eventId: "evt-1" }));
  const body = await res.json();
  assert.equal(body.import.externalWorkfileId, "WF-123");
  assert.equal(body.import.estimateVersion, "E01");
  assert.equal(body.import.supplementNumber, "S01");
  assert.equal(body.import.receivedAt, SAMPLE_DETAIL.receivedAt);
  assert.equal(body.import.vehicle.vinTail, "8415");
});

test("no CCC secrets or tokens are exposed in responses", async () => {
  mockPlan = "pro";
  const listBody = await (await GET()).json();
  const importBody = await (await POST(makeRequest({ eventId: "evt-1" }))).json();
  const serialized = JSON.stringify({ listBody, importBody }).toLowerCase();
  for (const needle of ["secret", "token", "private_key", "webhook_secret", "authorization"]) {
    assert.ok(!serialized.includes(needle), `response leaked "${needle}"`);
  }
});

test("unknown event → 404; disabled flag → 503", async () => {
  mockPlan = "pro";
  assert.equal((await POST(makeRequest({ eventId: "nope" }))).status, 404);
  process.env.CCC_SECURE_SHARE_PIPELINE_ENABLED = "false";
  assert.equal((await GET()).status, 503);
  process.env.CCC_SECURE_SHARE_PIPELINE_ENABLED = "true";
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
