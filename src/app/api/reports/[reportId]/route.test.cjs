/* eslint-disable @typescript-eslint/no-require-imports */
// Tests for Report Memory: GET /api/reports/[reportId] + gated /api/reports/history
// Run from project root: node "src/app/api/reports/[reportId]/route.test.cjs"

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
let mockUserId = "user-1";
let mockAuthShouldFail = false;
const mockRequireCurrentUser = async () => {
  if (mockAuthShouldFail) throw new MockUnauthorizedError();
  return {
    user: { id: mockUserId },
    isPlatformAdmin: mockPlan === "admin",
  };
};
const mockGetCurrentEntitlements = async () => ({
  plan: mockPlan,
  isPlatformAdmin: mockPlan === "admin",
  canUseBasicExports: mockPlan !== "starter",
});

// Stored reports keyed by (ownerUserId, reportId) — owner scope enforced like
// the real store (findFirst with ownerType/ownerId).
const REPORTS = {
  "user-1": {
    "rep-1": {
      id: "rep-1",
      createdAt: "2026-07-06T10:00:00.000Z",
      artifactIds: ["att-1", "att-2"],
      report: {
        summary: { riskScore: "moderate", confidence: "moderate", criticalIssues: 2, evidenceQuality: "moderate" },
        vehicle: { year: 2010, make: "Honda", model: "Civic" },
        issues: [],
        requiredProcedures: [],
        presentProcedures: [],
        missingProcedures: ["Seat belt inspection"],
        supplementOpportunities: ["Refinish blend"],
        evidence: [],
        recommendedActions: ["Request OEM procedure documentation."],
        findingReasoning: [{ issue: "Scan report missing from the file." }],
        sourceEstimateText: "ESTIMATE LINES ...",
        ingestionMeta: { active: true },
      },
    },
    "rep-scan": {
      id: "rep-scan",
      createdAt: "2026-07-07T10:00:00.000Z",
      artifactIds: [],
      report: {
        summary: { riskScore: "high", confidence: "moderate", criticalIssues: 1, evidenceQuality: "moderate" },
        issues: [], requiredProcedures: [], presentProcedures: [], missingProcedures: [],
        supplementOpportunities: [], evidence: [], recommendedActions: [],
        sourceEstimateText: "SCAN IQ — PRE/POST SCAN COMPARISON",
        ingestionMeta: { active: true, reportKind: "scan_iq" },
      },
    },
    "rep-ccc": {
      id: "rep-ccc",
      createdAt: "2026-07-07T11:00:00.000Z",
      artifactIds: [],
      report: {
        summary: { riskScore: "low", confidence: "moderate", criticalIssues: 0, evidenceQuality: "strong" },
        issues: [], requiredProcedures: [], presentProcedures: [], missingProcedures: [],
        supplementOpportunities: [], evidence: [], recommendedActions: [],
        ingestionMeta: { active: true, reportKind: "ccc_secure_share_import" },
        cccSecureShareImport: { sourceSystem: "CCC Secure Share", externalWorkfileId: "WF-1" },
      },
    },
  },
  "user-2": {
    "rep-other": { id: "rep-other", createdAt: "2026-07-01T00:00:00.000Z", artifactIds: [], report: { summary: { riskScore: "low" } } },
  },
};

let attachmentLookupFails = false;
const mockAnalysisReportStore = {
  getAnalysisReport: async (id, scope) => REPORTS[scope.ownerUserId]?.[id] ?? null,
  listAnalysisReportSummaries: async (scope) =>
    Object.values(REPORTS[scope.ownerUserId] ?? {}).map((record) => ({
      id: record.id,
      createdAt: record.createdAt,
      updatedAt: record.createdAt,
      title: "Report",
      vehicleLabel: null,
      insurer: null,
      riskScore: record.report?.summary?.riskScore ?? null,
      active: true,
      fileCount: (record.artifactIds ?? []).length,
    })),
};

const mockUploadedAttachmentStore = {
  getUploadedAttachments: async (ids) => {
    if (attachmentLookupFails) throw new Error("attachment store down");
    // Only att-1 still exists; att-2 was deleted.
    return ids
      .filter((id) => id === "att-1")
      .map((id) => ({ id, filename: "estimate.pdf", type: "application/pdf", text: "" }));
  },
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
  if (request === "@/lib/analysisReportStore") {
    return mockAnalysisReportStore;
  }
  if (request === "@/lib/uploadedAttachmentStore") {
    return mockUploadedAttachmentStore;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const detailRoute = require(path.join(cwd, "src", "app", "api", "reports", "[reportId]", "route.ts"));
const historyRoute = require(path.join(cwd, "src", "app", "api", "reports", "history", "route.ts"));

function detailRequest(reportId) {
  return detailRoute.GET({}, { params: Promise.resolve({ reportId }) });
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("starter user can list and open their own reports (customer presentation)", async () => {
  mockPlan = "starter";
  mockUserId = "user-1";
  assert.equal((await historyRoute.GET()).status, 200);

  const res = await detailRequest("rep-1");
  assert.equal(res.status, 200);
  const body = await res.json();
  // Customer-facing order: summary-first headline, supporting statements, NO technical block.
  assert.ok(body.detail.summary.headline.startsWith("Summary:"));
  assert.ok(body.detail.supportingStatements.length > 0);
  assert.equal(body.detail.technical, null);
});

test("pro user can open their own reports with technical metadata", async () => {
  mockPlan = "pro";
  const res = await detailRequest("rep-1");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.detail.technical);
  assert.equal(body.detail.technical.sourceSystem, "Collision IQ");
  assert.ok(body.detail.technical.missingProcedures.includes("Seat belt inspection"));
  assert.ok(body.detail.technical.savedReportExcerpt.includes("ESTIMATE LINES"));
  assert.equal(body.detail.metadata.canExport, true);
});

test("admin/platform admin can open authorized (own-scope) reports", async () => {
  mockPlan = "admin";
  const res = await detailRequest("rep-1");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.detail.technical);
});

test("free user cannot access report memory (list or detail)", async () => {
  mockPlan = "free";
  assert.equal((await historyRoute.GET()).status, 403);
  assert.equal((await detailRequest("rep-1")).status, 403);
});

test("another user's report id can never be opened (owner-scoped 404)", async () => {
  mockPlan = "pro";
  mockUserId = "user-1";
  const res = await detailRequest("rep-other"); // belongs to user-2
  assert.equal(res.status, 404);
  const body = await res.json();
  // No leakage of the other user's report data.
  assert.equal(body.detail, undefined);
});

test("missing attachments do not prevent the saved report from opening", async () => {
  mockPlan = "pro";
  const res = await detailRequest("rep-1");
  const body = await res.json();
  const refs = body.detail.attachments.refs;
  assert.equal(refs.length, 2);
  assert.equal(refs.find((r) => r.attachmentId === "att-1").available, true);
  assert.equal(refs.find((r) => r.attachmentId === "att-2").available, false);
  assert.ok(body.detail.attachments.unavailableNote.includes("no longer available"));

  // Even a total attachment-store failure still opens the saved report.
  attachmentLookupFails = true;
  const degraded = await detailRequest("rep-1");
  attachmentLookupFails = false;
  assert.equal(degraded.status, 200);
  const degradedBody = await degraded.json();
  assert.ok(degradedBody.detail.attachments.refs.every((r) => r.available === false));
});

test("Scan IQ reports appear in report memory with correct type", async () => {
  mockPlan = "pro";
  const res = await detailRequest("rep-scan");
  const body = await res.json();
  assert.equal(body.detail.metadata.reportType, "scan_iq");
  assert.equal(body.detail.metadata.sourceSystem, "Scan IQ");
  assert.ok(body.detail.summary.headline.startsWith("Summary:"));
});

test("CCC Secure Share imports appear in report memory with source metadata", async () => {
  mockPlan = "pro";
  const res = await detailRequest("rep-ccc");
  const body = await res.json();
  assert.equal(body.detail.metadata.reportType, "ccc_secure_share_import");
  assert.equal(body.detail.metadata.sourceSystem, "CCC Secure Share");
  assert.equal(body.detail.technical.importMetadata.externalWorkfileId, "WF-1");
});

test("unauthenticated requests are rejected on list and detail", async () => {
  mockAuthShouldFail = true;
  assert.equal((await historyRoute.GET()).status, 401);
  assert.equal((await detailRequest("rep-1")).status, 401);
  mockAuthShouldFail = false;
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
