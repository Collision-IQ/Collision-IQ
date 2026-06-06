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
  "Admin.One@example.com, second-admin@example.com ; CollisionAcademy@outlook.com\nspaced-admin@example.com, , PLAY-REVIEW@collision-iq.ai ";
process.env.PLATFORM_ADMIN_EMAILS = "platform-alias@example.com";
process.env.ADMIN_EMAILS = "legacy-admin@example.com, alias-admin@example.com";
process.env.ADMIN_EMAIL = "single-admin@example.com";
process.env.AUTHORIZED_ADMIN_EMAILS = "legacy-authorized@example.com";
process.env.NEXT_PUBLIC_ADMIN_EMAILS = "legacy-public@example.com";

const {
  getPlatformAdminEntitlementSource,
  isPlatformAdminEmail,
  isPlatformAdminEmailList,
} = require("../auth/platform-admin.ts");
const { isAdminEmail } = require("../admins.ts");
const { canAccessFeature } = require("../featureAccess.ts");
const { toAccountEntitlements } = require("./entitlements.ts");
const {
  canUploadFiles,
  getMaxUploadsPerReview,
  resolveProductEntitlements,
} = require("./productEntitlements.ts");

const BUILT_IN_FREE_ACCESS_EMAILS = [
  "vinny@collision.academy",
  "olga@collision.academy",
  "max@conestogacollision.com",
  "anthony@conestogacollision.com",
  "john@johnmcshane.com",
  "hempsteadcollision@gmail.com",
];

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

function assertFullAccess(entitlements) {
  assert.equal(entitlements.isPlatformAdmin, true);
  assert.equal(entitlements.plan, "admin");
  assert.equal(entitlements.entitlementSource, "free_access_admin");
  assert.equal(entitlements.canUseChatOnly, true);
  assert.equal(entitlements.canUseImmersiveReports, true);
  assert.equal(entitlements.canExport, true);
  assert.equal(entitlements.exportCap, null);
  assert.equal(entitlements.canUpload, true);
  assert.equal(entitlements.uploadCap, null);
  assert.equal(entitlements.canUseChatExport, true);
  assert.equal(entitlements.canUseRebuttalEmail, true);
  assert.equal(entitlements.canExportPolicyRightsReview, true);
  assert.equal(entitlements.canExportRepairIntelligence, true);
  assert.equal(entitlements.canExportEstimateScrubber, true);
  assert.equal(entitlements.trialActive, false);
  assert.equal(entitlements.trialStart, null);
  assert.equal(entitlements.trialEnd, null);
}

run("env admin emails are the source of truth", () => {
  assert.equal(isPlatformAdminEmail("admin.one@example.com"), true);
  assert.equal(isPlatformAdminEmail("SECOND-ADMIN@example.com"), true);
  assert.equal(isPlatformAdminEmail("CollisionAcademy@outlook.com"), true);
  assert.equal(isPlatformAdminEmail("collisionacademy@outlook.com"), true);
  assert.equal(isPlatformAdminEmail(" spaced-admin@example.com "), true);
  assert.equal(isPlatformAdminEmail("play-review@collision-iq.ai"), true);
  assert.equal(isPlatformAdminEmail("PLAY-REVIEW@COLLISION-IQ.AI"), true);
  assert.equal(isPlatformAdminEmail("platform-alias@example.com"), true);
  assert.equal(isPlatformAdminEmail("legacy-admin@example.com"), true);
  assert.equal(isPlatformAdminEmail("alias-admin@example.com"), true);
  assert.equal(isPlatformAdminEmail("single-admin@example.com"), true);
  assert.equal(isPlatformAdminEmail("not-admin@example.com"), false);
  assert.equal(isPlatformAdminEmail("legacy-authorized@example.com"), false);
  assert.equal(isPlatformAdminEmail("legacy-public@example.com"), false);
  assert.equal(isAdminEmail("admin.one@example.com"), true);
  const source = getPlatformAdminEntitlementSource();
  assert.equal(source.envKey, "COLLISION_IQ_PLATFORM_ADMIN_EMAILS");
  assert.deepEqual(source.envKeys, [
    "COLLISION_IQ_PLATFORM_ADMIN_EMAILS",
    "PLATFORM_ADMIN_EMAILS",
    "ADMIN_EMAILS",
    "ADMIN_EMAIL",
  ]);
  assert.equal(source.configuredAdminCount, 15);
  assert.equal(source.usesLegacyAdminEnv, true);
});

run("built-in free-access emails receive full access without subscription", () => {
  for (const email of BUILT_IN_FREE_ACCESS_EMAILS) {
    const entitlements = resolveProductEntitlements(
      buildAccess({
        plan: "none",
        activeSubscriptionId: null,
        activeSubscriptionStatus: null,
        canRunAnalysis: false,
      }),
      { userEmail: email }
    );

    assertFullAccess(entitlements);
  }
});

run("free-access admin match is case-insensitive", () => {
  const entitlements = resolveProductEntitlements(
    buildAccess({
      plan: "none",
      activeSubscriptionId: null,
      activeSubscriptionStatus: null,
      canRunAnalysis: false,
    }),
    { userEmail: "  VINNY@Collision.Academy  " }
  );

  assertFullAccess(entitlements);
});

run("free-access admin match works on secondary verified Clerk email", () => {
  assert.equal(
    isPlatformAdminEmailList(["primary@example.com", " MAX@ConestogaCollision.com "]),
    true
  );

  const entitlements = resolveProductEntitlements(
    buildAccess({
      plan: "none",
      activeSubscriptionId: null,
      activeSubscriptionStatus: null,
      canRunAnalysis: false,
    }),
    {
      userEmail: "primary@example.com",
      userEmails: ["primary@example.com", " MAX@ConestogaCollision.com "],
    }
  );

  assertFullAccess(entitlements);
});

run("env admins receive Pro-level entitlements", () => {
  const entitlements = toAccountEntitlements(
    buildAccess({
      canRunAnalysis: false,
    }),
    { userEmail: "  COLLISIONACADEMY@OUTLOOK.COM  " }
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

run("play review email receives admin entitlements from env list", () => {
  const entitlements = toAccountEntitlements(
    buildAccess({
      canRunAnalysis: false,
    }),
    { userEmail: " play-review@collision-iq.ai " }
  );

  assertFullAccess(entitlements);
  assert.equal(entitlements.maxUploadsPerReview, null);
});

run("env admin can upload even without subscription", () => {
  const entitlements = resolveProductEntitlements(
    buildAccess({
      plan: "none",
      activeSubscriptionId: null,
      activeSubscriptionStatus: null,
      canRunAnalysis: false,
    }),
    { userEmail: "admin.one@example.com" }
  );

  assert.equal(entitlements.isPlatformAdmin, true);
  assert.equal(canUploadFiles(entitlements), true);
  assert.equal(entitlements.uploadCap, null);
  assert.equal(entitlements.maxUploadsPerReview, null);
});

run("non-admin no-subscription can upload limited free files", () => {
  const expiredCreatedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  const entitlements = resolveProductEntitlements(
    buildAccess({
      createdAt: expiredCreatedAt,
      plan: "none",
      activeSubscriptionId: null,
      activeSubscriptionStatus: null,
      canRunAnalysis: false,
    }),
    { userEmail: "not-admin@example.com" }
  );

  assert.equal(entitlements.isPlatformAdmin, false);
  assert.equal(entitlements.plan, "free");
  assert.equal(entitlements.billingPlan, "free");
  assert.equal(entitlements.entitlementSource, "free");
  assert.equal(canUploadFiles(entitlements), true);
  assert.equal(entitlements.uploadCap, 5);
  assert.equal(entitlements.maxUploadsPerReview, 1);
});

run("trial user can upload", () => {
  const entitlements = resolveProductEntitlements(
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
  assert.equal(canUploadFiles(entitlements), true);
  assert.equal(entitlements.uploadCap, 100);
  assert.equal(entitlements.maxUploadsPerReview, 6);
});

run("active free trial can upload even when feature flags drift", () => {
  const entitlements = resolveProductEntitlements(
    buildAccess({
      plan: "none",
      activeSubscriptionId: null,
      activeSubscriptionStatus: null,
      featureFlags: {
        ...adminAccess.featureFlags,
        uploads: false,
      },
    }),
    {
      userEmail: "trial-window@example.com",
      trialActive: true,
      subscriptionTier: "none",
    }
  );

  assert.equal(entitlements.trialActive, true);
  assert.equal(entitlements.billingPlan, "trial");
  assert.equal(canUploadFiles(entitlements), true);
  assert.equal(entitlements.maxUploadsPerReview, 6);
});

run("brand-new non-admin account receives active 30-day trial", () => {
  const createdAt = new Date(Date.now() - 60 * 1000).toISOString();
  const entitlements = resolveProductEntitlements(
    buildAccess({
      createdAt,
      plan: "pro",
      activeSubscriptionId: null,
      activeSubscriptionStatus: null,
      canRunAnalysis: true,
    }),
    { userEmail: "new-user@example.com" }
  );

  assert.equal(entitlements.plan, "trial");
  assert.equal(entitlements.entitlementSource, "trial");
  assert.equal(entitlements.trialActive, true);
  assert.equal(entitlements.trialStart, createdAt);
  assert.equal(
    entitlements.trialEnd,
    new Date(new Date(createdAt).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
  );
});

run("brand-new authenticated free account receives active trial", () => {
  const createdAt = new Date(Date.now() - 60 * 1000).toISOString();
  const entitlements = resolveProductEntitlements(
    buildAccess({
      createdAt,
      plan: "none",
      activeSubscriptionId: null,
      activeSubscriptionStatus: null,
      canRunAnalysis: false,
    }),
    { userEmail: "new-free-user@example.com" }
  );

  assert.equal(entitlements.plan, "trial");
  assert.equal(entitlements.entitlementSource, "trial");
  assert.equal(entitlements.trialActive, true);
  assert.equal(entitlements.canUseCustomerReport, true);
  assert.equal(entitlements.maxUploadsPerReview, 6);
  assert.equal(entitlements.uploadCap, 100);
});

run("active trial grants Pro-like access", () => {
  const entitlements = resolveProductEntitlements(
    buildAccess({
      plan: "none",
      activeSubscriptionId: null,
      activeSubscriptionStatus: null,
      canRunAnalysis: false,
      featureFlags: {
        ...adminAccess.featureFlags,
      },
    }),
    {
      userEmail: "trial-user@example.com",
      trialActive: true,
    }
  );

  assert.equal(entitlements.plan, "trial");
  assert.equal(entitlements.canRunAnalysis, true);
  assert.equal(entitlements.canUseCustomerReport, true);
  assert.equal(entitlements.canUseRebuttalEmail, true);
  assert.equal(entitlements.canExportRepairIntelligence, true);
  assert.equal(entitlements.canExportPolicyRightsReview, true);
  assert.equal(entitlements.canExportEstimateScrubber, true);
  assert.equal(entitlements.canUseChatExport, true);
  assert.equal(entitlements.canUpload, true);
  assert.equal(entitlements.uploadCap, 100);
});

run("expired trial falls back to free access unless paid subscription exists", () => {
  const expiredCreatedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  const expired = resolveProductEntitlements(
    buildAccess({
      createdAt: expiredCreatedAt,
      plan: "none",
      activeSubscriptionId: null,
      activeSubscriptionStatus: null,
      canRunAnalysis: false,
    }),
    { userEmail: "expired@example.com" }
  );

  assert.equal(expired.plan, "free");
  assert.equal(expired.billingPlan, "free");
  assert.equal(expired.entitlementSource, "free");
  assert.equal(expired.trialActive, false);
  assert.equal(expired.canRunAnalysis, true);
  assert.equal(expired.canUpload, true);
  assert.equal(expired.uploadCap, 5);
  assert.equal(expired.maxUploadsPerReview, 1);
  assert.equal(expired.canExport, false);

  const paid = resolveProductEntitlements(
    buildAccess({
      createdAt: expiredCreatedAt,
      plan: "pro",
      activeSubscriptionId: "sub_pro",
      activeSubscriptionStatus: "ACTIVE",
      canRunAnalysis: true,
    }),
    {
      userEmail: "paid@example.com",
      subscriptionTier: "pro",
    }
  );

  assert.equal(paid.plan, "pro");
  assert.equal(paid.entitlementSource, "paid_subscription");
  assert.equal(paid.canUpload, true);
  assert.equal(paid.canExportRepairIntelligence, true);
});

run("Starter can upload one file", () => {
  const entitlements = resolveProductEntitlements(
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
  assert.equal(canUploadFiles(entitlements), true);
  assert.equal(entitlements.uploadCap, null);
  assert.equal(entitlements.maxUploadsPerReview, 1);
  assert.equal(getMaxUploadsPerReview("starter"), 1);
  assert.equal(entitlements.canExportSnapshot, true);
  assert.equal(entitlements.canExportRepairIntelligence, false);
  assert.equal(entitlements.canExportPolicyRightsReview, false);
  assert.equal(entitlements.canExportEstimateScrubber, false);
  assert.equal(canAccessFeature(entitlements.plan, "snapshot_export"), true);
  assert.equal(canAccessFeature(entitlements.plan, "repair_intelligence_export"), false);
});

run("backend upload/export/chat-only gates use resolved entitlement", () => {
  const trial = resolveProductEntitlements(
    buildAccess({
      plan: "none",
      activeSubscriptionId: null,
      activeSubscriptionStatus: null,
    }),
    {
      userEmail: "trial-gates@example.com",
      trialActive: true,
    }
  );

  assert.equal(canUploadFiles(trial), true);
  assert.equal(canAccessFeature(trial.plan, "repair_intelligence_export"), true);
  assert.equal(trial.canUseChatOnly, true);

  const free = resolveProductEntitlements(
    buildAccess({
      createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
      plan: "none",
      activeSubscriptionId: null,
      activeSubscriptionStatus: null,
      canRunAnalysis: false,
    }),
    { userEmail: "free-gates@example.com" }
  );

  assert.equal(free.plan, "free");
  assert.equal(canUploadFiles(free), true);
  assert.equal(canAccessFeature(free.plan, "repair_intelligence_export"), false);
  assert.equal(free.canUseChatOnly, true);
});

run("admin product plan bypass unlocks all exports", () => {
  assert.equal(canAccessFeature("admin", "snapshot_export"), true);
  assert.equal(canAccessFeature("admin", "repair_intelligence_export"), true);
  assert.equal(canAccessFeature("admin", "estimate_scrubber_export"), true);
  assert.equal(canAccessFeature("admin", "policy_rights_review_export"), true);
  assert.equal(canAccessFeature("admin", "doi_complaint_packet_export"), true);
  assert.equal(canAccessFeature("admin", "customer_report_export"), true);
});
