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
  MEMBERSHIP_UPGRADE_URL,
  TRIAL_EXPIRED_MESSAGE,
  STARTER_PRO_FEATURE_MESSAGE,
  FREE_PAID_FEATURE_MESSAGE,
  getEntitlementUpgradeMessage,
  resolveUserEntitlement,
} = require("./userEntitlementResolver.ts");

function run(name, test) {
  try {
    test();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

const now = new Date("2026-06-18T12:00:00.000Z");
const daysAgo = (days) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

run("new user receives active 30-day trial with Pro-level entitlements", () => {
  const result = resolveUserEntitlement({ createdAt: daysAgo(0) }, null, null, null, now);
  assert.equal(result.plan, "trial_pro");
  assert.equal(result.effectiveTier, "pro");
  assert.equal(result.trialActive, true);
  assert.equal(result.features.proReports, true);
});

run("user on day 29 still has trial Pro access", () => {
  const result = resolveUserEntitlement({ createdAt: daysAgo(29) }, null, null, null, now);
  assert.equal(result.plan, "trial_pro");
  assert.equal(result.trialActive, true);
  assert.equal(result.trialExpired, false);
});

run("user at or after day 30 expires to Free unless paid", () => {
  const result = resolveUserEntitlement({ createdAt: daysAgo(30) }, null, null, null, now);
  assert.equal(result.plan, "free");
  assert.equal(result.effectiveTier, "free");
  assert.equal(result.trialActive, false);
  assert.equal(result.trialExpired, true);
});

run("expired trial response includes upgrade URL and public copy", () => {
  const result = resolveUserEntitlement({ createdAt: daysAgo(31) }, null, null, null, now);
  assert.equal(result.upgradeUrl, MEMBERSHIP_UPGRADE_URL);
  assert.equal(getEntitlementUpgradeMessage({ plan: result.plan, trialExpired: result.trialExpired }), TRIAL_EXPIRED_MESSAGE);
  assert.match(TRIAL_EXPIRED_MESSAGE, /https:\/\/www\.collision-iq\.ai\/technical-systems/);
  assert.doesNotMatch(TRIAL_EXPIRED_MESSAGE, /admin/i);
});

run("paid Pro user keeps Pro access regardless of trial date", () => {
  const result = resolveUserEntitlement(
    { createdAt: daysAgo(90) },
    null,
    { plan: "PRO", status: "ACTIVE" },
    null,
    now
  );
  assert.equal(result.plan, "pro");
  assert.equal(result.effectiveTier, "pro");
  assert.equal(result.paidActive, true);
  assert.equal(result.trialExpired, false);
});

run("Starter user receives Starter entitlements, not Free and not Pro", () => {
  const result = resolveUserEntitlement(
    { createdAt: daysAgo(90) },
    null,
    { plan: "STARTER", status: "ACTIVE" },
    null,
    now
  );
  assert.equal(result.plan, "starter");
  assert.equal(result.effectiveTier, "starter");
  assert.equal(result.features.snapshotExport, true);
  assert.equal(result.features.proReports, false);
  assert.equal(getEntitlementUpgradeMessage({ plan: result.plan, requiresPro: true }), STARTER_PRO_FEATURE_MESSAGE);
});

run("Admin receives Admin entitlement and is not mapped to public package", () => {
  const result = resolveUserEntitlement({ isPlatformAdmin: true, createdAt: daysAgo(90) }, null, { plan: "PRO", status: "INACTIVE" }, null, now);
  assert.equal(result.plan, "admin");
  assert.equal(result.effectiveTier, "admin");
  assert.equal(result.admin, true);
  assert.equal(result.paidActive, false);
});

run("mobile and API can use the same resolver output as web", () => {
  const web = resolveUserEntitlement({ id: "u1", createdAt: daysAgo(5) }, null, null, null, now);
  const mobile = resolveUserEntitlement({ id: "u1", createdAt: daysAgo(5) }, null, null, null, now);
  assert.deepEqual(mobile, web);
});

run("report/chat/API route gates can use effective tier", () => {
  const trial = resolveUserEntitlement({ createdAt: daysAgo(2) }, null, null, null, now);
  const starter = resolveUserEntitlement({ createdAt: daysAgo(90) }, null, { plan: "STARTER", status: "ACTIVE" }, null, now);
  assert.equal(trial.effectiveTier === "pro" && trial.features.proReports, true);
  assert.equal(starter.effectiveTier === "starter" && starter.features.proReports, false);
});

run("Stripe inactive subscription does not incorrectly keep Pro entitlement", () => {
  const result = resolveUserEntitlement({ createdAt: daysAgo(90) }, null, { plan: "PRO", status: "CANCELED" }, null, now);
  assert.equal(result.plan, "free");
  assert.equal(result.paidActive, false);
});

run("Stripe active subscription keeps paid tier", () => {
  const result = resolveUserEntitlement({ createdAt: daysAgo(90) }, null, { plan: "PRO", status: "PAST_DUE" }, null, now);
  assert.equal(result.plan, "pro");
  assert.equal(result.paidActive, true);
});

run("missing Stripe data does not crash entitlement resolution", () => {
  assert.doesNotThrow(() => resolveUserEntitlement({ createdAt: daysAgo(1) }, null, null, null, now));
});

run("missing Clerk metadata does not crash entitlement resolution", () => {
  assert.doesNotThrow(() => resolveUserEntitlement({ createdAt: daysAgo(1) }, null, null, undefined, now));
});

run("trial start and end dates are deterministic", () => {
  const createdAt = "2026-06-01T00:00:00.000Z";
  const first = resolveUserEntitlement({ createdAt }, null, null, null, now);
  const second = resolveUserEntitlement({ createdAt }, null, null, null, now);
  assert.equal(first.trialStartedAt, createdAt);
  assert.equal(first.trialEndsAt, "2026-07-01T00:00:00.000Z");
  assert.deepEqual(first, second);
});

run("free user upgrade copy includes membership URL", () => {
  assert.equal(getEntitlementUpgradeMessage({ plan: "free" }), FREE_PAID_FEATURE_MESSAGE);
  assert.match(FREE_PAID_FEATURE_MESSAGE, /https:\/\/www\.collision-iq\.ai\/technical-systems/);
});
