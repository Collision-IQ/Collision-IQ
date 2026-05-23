/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveFilenameWithAlias(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    const absolute = path.join(process.cwd(), "src", request.slice(2));
    return originalResolveFilename.call(this, absolute, parent, isMain, options);
  }

  return originalResolveFilename.call(this, request, parent, isMain, options);
};

require.extensions[".ts"] = function registerTypeScript(module, filename) {
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

const {
  areInternalRetrievalPathsResolved,
  createAgentRetrievalTrace,
  recordAgentRetrievalStep,
  sanitizeTraceReason,
} = require("./agentRetrievalTrace.ts");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("records estimate link retrieval before web search", () => {
  const trace = createAgentRetrievalTrace({
    flow: "chat",
    runId: "test-link-order",
    startedAt: "2026-05-21T00:00:00.000Z",
  });

  recordAgentRetrievalStep(trace, {
    order: 3,
    tool: "web_search",
    action: "internet_search",
    resultCount: 0,
    status: "skipped",
    reason: "Internal sources attempted first.",
  });
  recordAgentRetrievalStep(trace, {
    order: 1,
    tool: "estimate_link_reader",
    action: "open_estimate_links",
    resultCount: 1,
    status: "success",
  });

  assert.deepEqual(trace.steps.map((step) => step.tool), [
    "estimate_link_reader",
    "web_search",
  ]);
});

run("records Google Drive/internal search before web search", () => {
  const trace = createAgentRetrievalTrace({
    flow: "analysis",
    runId: "test-drive-order",
    startedAt: "2026-05-21T00:00:00.000Z",
  });

  recordAgentRetrievalStep(trace, {
    order: 1,
    tool: "estimate_link_reader",
    action: "open_estimate_links",
    resultCount: 0,
    status: "skipped",
    reason: "No links found.",
  });
  recordAgentRetrievalStep(trace, {
    order: 2,
    tool: "google_drive_search",
    action: "search_internal_sources",
    resultCount: 2,
    status: "success",
  });
  recordAgentRetrievalStep(trace, {
    order: 3,
    tool: "web_search",
    action: "internet_search",
    resultCount: 0,
    status: "success",
    reason: "Internal sources attempted first.",
  });

  assert.deepEqual(trace.steps.map((step) => step.tool), [
    "estimate_link_reader",
    "google_drive_search",
    "web_search",
  ]);
});

run("does not allow internet search until estimate links and internal search are resolved", () => {
  const trace = createAgentRetrievalTrace({
    flow: "analysis",
    runId: "test-web-gate",
    startedAt: "2026-05-21T00:00:00.000Z",
  });

  recordAgentRetrievalStep(trace, {
    order: 1,
    tool: "estimate_link_reader",
    action: "open_estimate_links",
    resultCount: 0,
    status: "skipped",
    reason: "No links found.",
  });

  assert.equal(areInternalRetrievalPathsResolved(trace), false);

  recordAgentRetrievalStep(trace, {
    order: 2,
    tool: "google_drive_search",
    action: "search_internal_sources",
    resultCount: 0,
    status: "skipped",
    reason: "Google Drive unavailable.",
  });

  assert.equal(areInternalRetrievalPathsResolved(trace), true);
});

run("suppresses raw provider quota and billing details from trace reasons", () => {
  assert.equal(
    sanitizeTraceReason("OpenAI quota exceeded: please check billing and api key"),
    "Provider/internal detail suppressed."
  );

  const trace = createAgentRetrievalTrace({
    flow: "chat",
    runId: "test-sanitize",
    startedAt: "2026-05-21T00:00:00.000Z",
  });
  recordAgentRetrievalStep(trace, {
    order: 2,
    tool: "google_drive_search",
    action: "search_internal_sources",
    resultCount: 0,
    status: "error",
    reason: "OpenAI rate limit reached for project billing account",
  });

  assert.equal(trace.steps[0].reason, "Provider/internal detail suppressed.");
});
