/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
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

const { buildPolicyLegalRegulationsEndpointResult } = require("../src/lib/policyLegal/regulationsEndpoint.ts");
const { buildPolicyLegalHealthPayload } = require("../src/lib/policyLegal/health.ts");
const { buildPolicyLegalReviewIfEnabled } = require("../src/lib/policyLegal/gate.ts");

async function main() {
  const baseUrl = process.env.POLICY_LEGAL_SMOKE_BASE_URL?.trim();
  if (baseUrl) {
    await runLiveSmoke(baseUrl);
  } else {
    await runHelperSmoke();
  }

  console.log("PASS policy/legal smoke");
}

async function runLiveSmoke(baseUrl) {
  if (process.env.POLICY_LEGAL_SMOKE_USE_VERCEL_CURL === "true") {
    await runVercelCurlSmoke(baseUrl);
    return;
  }

  const health = await fetch(new URL("/api/policy-legal/health", baseUrl));
  assert.equal(health.ok, true, "health endpoint should respond successfully");
  const healthBody = await health.json();
  assert.equal(typeof healthBody.enabled, "boolean");
  assert.equal(typeof healthBody.regulation_table_reachable, "boolean");
  assert.equal(typeof healthBody.placeholder_dataset_available, "boolean");
  assert.equal(typeof healthBody.verified_regulation_count, "number");
  assert.equal(
    healthBody.last_snapshot_timestamp === null ||
      typeof healthBody.last_snapshot_timestamp === "string",
    true
  );

  const regulations = await fetch(new URL("/api/policy-legal/regulations?state=FL", baseUrl));
  assert.equal(regulations.status, 401, "regulations endpoint should block unauthenticated access");
}

async function runVercelCurlSmoke(baseUrl) {
  const healthBody = vercelCurlJson("/api/policy-legal/health", baseUrl);
  assert.equal(typeof healthBody.enabled, "boolean");
  assert.equal(typeof healthBody.regulation_table_reachable, "boolean");
  assert.equal(typeof healthBody.placeholder_dataset_available, "boolean");
  assert.equal(typeof healthBody.verified_regulation_count, "number");
  assert.equal(
    healthBody.last_snapshot_timestamp === null ||
      typeof healthBody.last_snapshot_timestamp === "string",
    true
  );

  const regulationsBody = vercelCurlJson("/api/policy-legal/regulations?state=FL", baseUrl);
  assert.match(
    regulationsBody.error,
    /Authentication is required|No authenticated Clerk session/,
    "regulations endpoint should block unauthenticated access"
  );
}

function vercelCurlJson(pathname, deploymentUrl) {
  const args = ["curl", pathname, "--deployment", deploymentUrl];
  const command = process.platform === "win32" ? "cmd.exe" : "vercel";
  const commandArgs =
    process.platform === "win32" ? ["/c", "vercel.cmd", ...args] : args;
  const output = execFileSync(
    command,
    commandArgs,
    {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  const jsonStart = output.indexOf("{");
  const jsonEnd = output.indexOf("}", jsonStart);
  assert.ok(jsonStart >= 0 && jsonEnd > jsonStart, `Expected JSON from vercel curl ${pathname}`);
  return JSON.parse(output.slice(jsonStart, jsonEnd + 1));
}

async function runHelperSmoke() {
  const health = await buildPolicyLegalHealthPayload({
    env: { POLICY_LEGAL_INTELLIGENCE_ENABLED: "false" },
    countVerifiedRegulations: async () => 0,
    findLastSnapshot: async () => null,
  });
  assert.equal(health.enabled, false);
  assert.equal(health.regulation_table_reachable, true);
  assert.equal(health.placeholder_dataset_available, true);
  assert.equal(health.verified_regulation_count, 0);
  assert.equal(health.last_snapshot_timestamp, null);

  const regulations = await buildPolicyLegalRegulationsEndpointResult({
    state: "FL",
    currentUser: null,
    findRegulations: async () => [],
  });
  assert.equal(regulations.status, 401);

  const review = buildPolicyLegalReviewIfEnabled({
    context: {
      claim_state: "FL",
      applicable_regulations: [],
      oem_procedures: [],
      carrier_guidelines: [],
      policy_context: {},
      citation_required: true,
    },
    report: {
      summary: {
        riskScore: "moderate",
        confidence: "moderate",
        criticalIssues: 0,
        evidenceQuality: "weak",
      },
      issues: [],
      requiredProcedures: [],
      presentProcedures: [],
      missingProcedures: [],
      supplementOpportunities: [],
      evidence: [],
      recommendedActions: [],
    },
    operations: [],
    env: { POLICY_LEGAL_INTELLIGENCE_ENABLED: "false" },
  });
  assert.equal(review, undefined);
}

main().catch((error) => {
  console.error("FAIL policy/legal smoke");
  console.error(error);
  process.exit(1);
});
