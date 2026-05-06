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

process.env.COLLISION_IQ_PLATFORM_ADMIN_EMAILS =
  "Admin.One@example.com,second-admin@example.com";

const {
  getPlatformAdminEntitlementSource,
  isPlatformAdminEmail,
} = require("../auth/platform-admin.ts");
const { isAdminEmail } = require("../admins.ts");
const { canAccessFeature } = require("../featureAccess.ts");
const { toAccountEntitlements } = require("./entitlements.ts");

function run(name, test) {
  try {
    test();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const adminAccess = {
  isAuthenticated: true,
  isPlatformAdmin: true,
  userId: "user_admin",
  clerkUserId: "clerk_admin",
  createdAt: "2026-05-06T12:00:00.000Z",
  plan: "none",
  featureFlags: {
    basic_chat: false,
    uploads: false,
    at_a_glance: false,
    what_stands_out: false,
    vehicle_context: false,
    basic_pdf_export: false,
    redacted_chat_export: false,
    supplement_lines: false,
    negotiation_draft: false,
    rebuttal_email: false,
    side_by_side_report: false,
    line_by_line_report: false,
    shop_management: false,
    pooled_usage: false,
    customer_report: false,
  },
  monthlyAnalysisLimit: 0,
  monthlyAnalysisUsed: 0,
  canRunAnalysis: false,
  dbUserId: "db_admin",
  activeSubscriptionId: null,
  activeSubscriptionStatus: null,
  activeShopId: null,
  consentStatus: null,
};

function buildAccess(overrides) {
  return {
    ...adminAccess,
    isPlatformAdmin: false,
    canRunAnalysis: true,
    plan: "none",
    activeSubscriptionId: null,
    activeSubscriptionStatus: null,
    featureFlags: {
      ...adminAccess.featureFlags,
    },
    ...overrides,
  };
}

run("env admin emails are the source of truth", () => {
  assert.equal(isPlatformAdminEmail("admin.one@example.com"), true);
  assert.equal(isPlatformAdminEmail("SECOND-ADMIN@example.com"), true);
  assert.equal(isPlatformAdminEmail("not-admin@example.com"), false);
  assert.equal(isAdminEmail("admin.one@example.com"), true);
  assert.deepEqual(getPlatformAdminEntitlementSource(), {
    envKey: "COLLISION_IQ_PLATFORM_ADMIN_EMAILS",
    configuredAdminCount: 2,
  });
});

run("env admins receive Pro-level entitlements", () => {
  const entitlements = toAccountEntitlements(
    buildAccess({
      canRunAnalysis: false,
    }),
    { userEmail: "admin.one@example.com" }
  );

  assert.equal(entitlements.plan, "admin");
  assert.equal(entitlements.canRunAnalysis, true);
  assert.equal(entitlements.canUpload, true);
  assert.equal(entitlements.uploadCap, null);
  assert.equal(entitlements.canUseChatOnly, true);
  assert.equal(entitlements.canUseImmersiveReports, true);
  assert.equal(entitlements.canExport, true);
  assert.equal(entitlements.exportCap, null);
  assert.equal(entitlements.canExportSnapshot, true);
  assert.equal(entitlements.canExportRepairIntelligence, true);
  assert.equal(entitlements.canExportPolicyRightsReview, true);
  assert.equal(entitlements.canExportEstimateScrubber, true);
  assert.equal(entitlements.canUseRedactedChatExport, true);
  assert.equal(entitlements.canUseChatExport, true);
  assert.equal(entitlements.canUseRebuttalEmail, true);
});

run("env admin can upload even without subscription", () => {
  const entitlements = toAccountEntitlements(
    buildAccess({
      plan: "none",
      activeSubscriptionId: null,
      activeSubscriptionStatus: null,
      canRunAnalysis: false,
    }),
    { userEmail: "admin.one@example.com" }
  );

  assert.equal(entitlements.isPlatformAdmin, true);
  assert.equal(entitlements.canUpload, true);
  assert.equal(entitlements.uploadCap, null);
});

run("non-admin no-subscription cannot upload", () => {
  const entitlements = toAccountEntitlements(
    buildAccess({
      plan: "none",
      activeSubscriptionId: null,
      activeSubscriptionStatus: null,
      canRunAnalysis: false,
    }),
    { userEmail: "not-admin@example.com" }
  );

  assert.equal(entitlements.isPlatformAdmin, false);
  assert.equal(entitlements.canUpload, false);
  assert.equal(entitlements.uploadCap, 0);
});

run("trial user can upload", () => {
  const entitlements = toAccountEntitlements(
    buildAccess({
      plan: "pro",
      activeSubscriptionId: "sub_trial",
      activeSubscriptionStatus: "TRIALING",
      featureFlags: {
        ...adminAccess.featureFlags,
        uploads: true,
      },
    }),
    { userEmail: "trial-user@example.com" }
  );

  assert.equal(entitlements.billingPlan, "trial");
  assert.equal(entitlements.canUpload, true);
  assert.equal(entitlements.uploadCap, null);
});

run("Starter can upload one file", () => {
  const entitlements = toAccountEntitlements(
    buildAccess({
      plan: "starter",
      activeSubscriptionId: "sub_starter",
      activeSubscriptionStatus: "ACTIVE",
      featureFlags: {
        ...adminAccess.featureFlags,
        uploads: true,
      },
    }),
    { userEmail: "starter-user@example.com" }
  );

  assert.equal(entitlements.billingPlan, "starter");
  assert.equal(entitlements.canUpload, true);
  assert.equal(entitlements.uploadCap, 1);
});

run("admin product plan bypass unlocks all exports", () => {
  assert.equal(canAccessFeature("admin", "snapshot_export"), true);
  assert.equal(canAccessFeature("admin", "repair_intelligence_export"), true);
  assert.equal(canAccessFeature("admin", "estimate_scrubber_export"), true);
  assert.equal(canAccessFeature("admin", "policy_rights_review_export"), true);
  assert.equal(canAccessFeature("admin", "doi_complaint_packet_export"), true);
  assert.equal(canAccessFeature("admin", "customer_report_export"), true);
});
