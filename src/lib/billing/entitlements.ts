import { getPlanAnalysisCap, PRO_TRIAL_DAYS, type BillingPlan } from "@/lib/billing/plans";
import {
  getCurrentViewerAccess,
  getFeatureFlagsForPlan,
  type ViewerAccess,
} from "@/lib/entitlements";
import { getUsageCount as getMeteredUsageCount } from "@/lib/usage";
import { isPlatformAdminEmailList, maskEmail, normalizeEmail } from "@/lib/auth/platform-admin";

const TRIAL_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export type EntitlementResolutionContext = {
  userEmail?: string | null;
  userEmails?: Array<string | null | undefined>;
  trialActive?: boolean;
  subscriptionTier?: BillingPlan | "admin" | null;
  isPlatformAdmin?: boolean;
};

export type AccountEntitlements = Omit<ViewerAccess, "plan"> & {
  plan: "admin" | BillingPlan;
  subscriptionStatus: "active" | "inactive";
  usage: {
    capped: boolean;
    used: number;
    remaining: number | null;
  };
  billingPlan: BillingPlan;
  analysisCap: number;
  analysisCount: number;
  canUpload: boolean;
  uploadCap: number | null;
  uploadCount: number;
  canExport: boolean;
  exportCap: number | null;
  exportCount: number;
  canUseBasicExports: boolean;
  canUseCustomerReport: boolean;
  canUseRedactedChatExport: boolean;
  canUseSupplementLines: boolean;
  canUseNegotiationDraft: boolean;
  canUseRebuttalEmail: boolean;
  canUseChatOnly: boolean;
  canUseImmersiveReports: boolean;
  canExportSnapshot: boolean;
  canExportRepairIntelligence: boolean;
  canExportPolicyRightsReview: boolean;
  canExportEstimateScrubber: boolean;
  canUseChatExport: boolean;
  trialActive: boolean;
  trialStart: string | null;
  trialEnd: string | null;
  maxUploadsPerReview: number | null;
  usageStatus: "ok" | "usage_limit_reached" | "trial_expired" | "upgrade_required";
  entitlementSource: "free_access_admin" | "paid_subscription" | "trial" | "starter_subscription" | "free" | "locked";
};

export async function getCurrentEntitlements(
  params?: EntitlementResolutionContext
): Promise<AccountEntitlements> {
  const access = await getCurrentViewerAccess();
  const entitlements = toAccountEntitlements(access, {
    userEmail: params?.userEmail,
    userEmails: params?.userEmails,
    trialActive: params?.trialActive,
    subscriptionTier: params?.subscriptionTier,
    isPlatformAdmin: params?.isPlatformAdmin,
  });

  logEntitlementDiagnostics(entitlements, {
    userEmail: params?.userEmail,
    userEmails: params?.userEmails,
  });

  if (entitlements.isPlatformAdmin || !entitlements.dbUserId) {
    return entitlements;
  }

  let uploadCount = 0;
  let exportCount = 0;

  const results = await Promise.allSettled([
    getMeteredUsageCount(entitlements.dbUserId, "FILE_UPLOAD"),
    getMeteredUsageCount(entitlements.dbUserId, "REPORT_EXPORT"),
  ]);

  uploadCount = results[0].status === "fulfilled" ? results[0].value : 0;
  exportCount = results[1].status === "fulfilled" ? results[1].value : 0;

  if (results.some((result) => result.status === "rejected")) {
    console.error("[entitlements] usage read failed (non-blocking)", {
      userId: entitlements.dbUserId,
      results,
    });
  }

  return {
    ...entitlements,
    uploadCount,
    exportCount,
  };
}

export function canRunAnalysis(entitlements: AccountEntitlements) {
  return entitlements.canRunAnalysis;
}

export function canUseBasicExports(entitlements: AccountEntitlements) {
  return entitlements.canUseBasicExports;
}

export function canUseCustomerReport(entitlements: AccountEntitlements) {
  return entitlements.canUseCustomerReport;
}

export function canUseSupplementLines(entitlements: AccountEntitlements) {
  return entitlements.canUseSupplementLines;
}

export function canUseNegotiationDraft(entitlements: AccountEntitlements) {
  return entitlements.canUseNegotiationDraft;
}

export function canUseRebuttalEmail(entitlements: AccountEntitlements) {
  return entitlements.canUseRebuttalEmail;
}

export function toAccountEntitlements(
  access: ViewerAccess,
  params?: EntitlementResolutionContext
): AccountEntitlements {
  const resolvedEmails = [
    ...(params?.userEmails ?? []),
    params?.userEmail,
  ]
    .map((email) => normalizeEmail(email))
    .filter(Boolean);
  const isEnvAdmin = isPlatformAdminEmailList(resolvedEmails);
  const trialActive = resolveEffectiveTrialActive(access, params?.trialActive);
  const contextAdmin = Boolean(params?.isPlatformAdmin);
  const trialWindow = resolveTrialWindow(access);

  if (access.isPlatformAdmin || contextAdmin || isEnvAdmin) {
    return {
      ...access,
      isPlatformAdmin: true,
      plan: "admin",
      canRunAnalysis: true,
      subscriptionStatus: "active",
      usage: {
        capped: false,
        used: 0,
        remaining: null,
      },
      billingPlan: "team",
      analysisCap: Number.MAX_SAFE_INTEGER,
      analysisCount: 0,
      canUpload: true,
      uploadCap: null,
      uploadCount: 0,
      canExport: true,
      exportCap: null,
      exportCount: 0,
      canUseBasicExports: true,
      canUseCustomerReport: true,
      canUseRedactedChatExport: true,
      canUseSupplementLines: true,
      canUseNegotiationDraft: true,
      canUseRebuttalEmail: true,
      canUseChatOnly: true,
      canUseImmersiveReports: true,
      canExportSnapshot: true,
      canExportRepairIntelligence: true,
      canExportPolicyRightsReview: true,
      canExportEstimateScrubber: true,
      canUseChatExport: true,
      trialActive: false,
      trialStart: null,
      trialEnd: null,
      maxUploadsPerReview: getPlanUploadBatchLimit("admin"),
      usageStatus: "ok",
      entitlementSource: "free_access_admin",
    };
  }

  const billingPlan = resolveBillingPlan(access, {
    subscriptionTier: params?.subscriptionTier,
    trialActive,
  });
  const analysisCap = getPlanAnalysisCap(billingPlan);
  const analysisCount = access.monthlyAnalysisUsed;
  const isFree = billingPlan === "free";
  const isProLike = billingPlan === "trial" || billingPlan === "pro" || billingPlan === "team";
  const hasAnyAccess = billingPlan !== "none";
  const resolvedCanRunAnalysis = isProLike || isFree ? true : access.canRunAnalysis;
  const capped = billingPlan !== "team";
  const remaining = Math.max(analysisCap - analysisCount, 0);

  const usageStatus = !access.isAuthenticated
    ? "upgrade_required"
    : billingPlan === "none"
      ? "upgrade_required"
    : !resolvedCanRunAnalysis && billingPlan === "trial"
      ? "trial_expired"
      : !resolvedCanRunAnalysis
        ? "usage_limit_reached"
        : "ok";

  const subscriptionStatus =
    access.activeSubscriptionStatus === "ACTIVE" || access.activeSubscriptionStatus === "TRIALING"
      ? "active"
      : "inactive";

  return {
    ...access,
    plan: billingPlan,
    featureFlags: isProLike ? getFeatureFlagsForPlan("pro") : access.featureFlags,
    subscriptionStatus,
    usage: {
      capped,
      used: analysisCount,
      remaining,
    },
    billingPlan,
    analysisCap,
    analysisCount,
    canRunAnalysis: resolvedCanRunAnalysis,
    canUpload: access.isAuthenticated,
    uploadCap: getPlanUploadCap(billingPlan),
    uploadCount: 0,
    canExport: hasAnyAccess && !isFree,
    exportCap: getPlanExportCap(billingPlan),
    exportCount: 0,
    canUseBasicExports: hasAnyAccess && !isFree,
    canUseCustomerReport: isProLike,
    canUseRedactedChatExport: isProLike,
    canUseSupplementLines: isProLike,
    canUseNegotiationDraft: isProLike,
    canUseRebuttalEmail: isProLike,
    canUseChatOnly: hasAnyAccess,
    canUseImmersiveReports:
      billingPlan === "trial" ||
      billingPlan === "starter" ||
      billingPlan === "pro" ||
      billingPlan === "team",
    canExportSnapshot:
      billingPlan === "trial" ||
      billingPlan === "starter" ||
      billingPlan === "pro" ||
      billingPlan === "team",
    canExportRepairIntelligence:
      billingPlan === "trial" || billingPlan === "pro" || billingPlan === "team",
    canExportPolicyRightsReview:
      billingPlan === "trial" || billingPlan === "pro" || billingPlan === "team",
    canExportEstimateScrubber:
      billingPlan === "trial" || billingPlan === "pro" || billingPlan === "team",
    canUseChatExport: billingPlan === "trial" || billingPlan === "pro" || billingPlan === "team",
    trialActive,
    trialStart: billingPlan === "trial" ? trialWindow.start : null,
    trialEnd: billingPlan === "trial" ? trialWindow.end : null,
    maxUploadsPerReview: getPlanUploadBatchLimit(billingPlan),
    usageStatus,
    entitlementSource: resolveEntitlementSource(billingPlan, params?.subscriptionTier),
  };
}

function resolveBillingPlan(
  access: ViewerAccess,
  params?: { subscriptionTier?: BillingPlan | "admin" | null; trialActive?: boolean }
): BillingPlan {
  if (!access.isAuthenticated) {
    return "none";
  }

  if (params?.subscriptionTier && params.subscriptionTier !== "admin") {
    if (
      params.subscriptionTier === "starter" ||
      params.subscriptionTier === "pro" ||
      params.subscriptionTier === "team"
    ) {
      return params.subscriptionTier;
    }

    if (params?.trialActive) {
      return "trial";
    }

    return "free";
  }

  if (params?.trialActive) {
    return "trial";
  }

  if (access.plan === "none") {
    return "free";
  }

  if (access.plan === "team") {
    return "team";
  }

  if (access.activeSubscriptionStatus === "TRIALING") {
    return "trial";
  }

  if (access.plan === "pro") {
    return "pro";
  }

  if (access.plan === "starter" && access.activeSubscriptionId) {
    return "starter";
  }

  return "free";
}

export function resolveTrialActive(
  access: Pick<ViewerAccess, "activeSubscriptionStatus" | "activeSubscriptionId" | "createdAt" | "plan">
) {
  if (access.activeSubscriptionStatus === "TRIALING") {
    return true;
  }

  if (access.activeSubscriptionId || access.activeSubscriptionStatus === "ACTIVE") {
    return false;
  }

  if (!access.createdAt) {
    return false;
  }

  const createdAtMs = new Date(access.createdAt).getTime();
  if (Number.isNaN(createdAtMs)) {
    return false;
  }

  return Date.now() - createdAtMs < TRIAL_DURATION_MS;
}

function resolveEffectiveTrialActive(access: ViewerAccess, explicitTrialActive?: boolean) {
  if (access.activeSubscriptionStatus === "TRIALING") {
    return true;
  }

  if (access.activeSubscriptionId || access.activeSubscriptionStatus === "ACTIVE") {
    return false;
  }

  if (typeof explicitTrialActive === "boolean") {
    return explicitTrialActive;
  }

  return resolveTrialActive(access);
}

function resolveTrialWindow(access: Pick<ViewerAccess, "createdAt">) {
  if (!access.createdAt) {
    return { start: null, end: null };
  }

  const start = new Date(access.createdAt);
  if (Number.isNaN(start.getTime())) {
    return { start: null, end: null };
  }

  const end = new Date(start.getTime() + PRO_TRIAL_DAYS * 24 * 60 * 60 * 1000);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function resolveEntitlementSource(
  billingPlan: BillingPlan,
  subscriptionTier?: BillingPlan | "admin" | null
): AccountEntitlements["entitlementSource"] {
  if (subscriptionTier === "pro" || subscriptionTier === "team") {
    return "paid_subscription";
  }

  if (billingPlan === "trial") {
    return "trial";
  }

  if (billingPlan === "starter") {
    return "starter_subscription";
  }

  if (billingPlan === "free") {
    return "free";
  }

  return "locked";
}

function logEntitlementDiagnostics(
  entitlements: AccountEntitlements,
  params?: { userEmail?: string | null; userEmails?: Array<string | null | undefined> }
) {
  console.info("[entitlements] resolved", {
    userId: entitlements.dbUserId ?? entitlements.userId,
    email: maskEmail(normalizeEmail(params?.userEmail ?? null) || null),
    verifiedEmails: (params?.userEmails ?? []).map((email) => maskEmail(normalizeEmail(email))),
    isFreeAccessAdmin: entitlements.entitlementSource === "free_access_admin",
    subscriptionTier: entitlements.billingPlan,
    entitlementTier: entitlements.plan,
    trialStart: entitlements.trialStart,
    trialEnd: entitlements.trialEnd,
    trialActive: entitlements.trialActive,
    resolvedPlan: entitlements.plan,
    entitlementSource: entitlements.entitlementSource,
  });
}

export function getPlanUploadCap(plan: BillingPlan): number | null {
  switch (plan) {
    case "free":
      return 5;
    case "starter":
      return null;
    case "pro":
    case "trial":
      return 100;
    case "team":
      return null;
    case "none":
      return 0;
    default:
      return 0;
  }
}

export function getPlanUploadBatchLimit(plan: BillingPlan | "admin"): number | null {
  switch (plan) {
    case "admin":
    case "team":
      return null;
    case "trial":
    case "pro":
      return 6;
    case "starter":
    case "free":
    case "none":
      return 1;
    default:
      return 1;
  }
}

export function getPlanExportCap(plan: BillingPlan): number | null {
  switch (plan) {
    case "starter":
      return 1;
    case "trial":
    case "pro":
    case "team":
      return null;
    case "free":
    case "none":
      return 0;
    default:
      return 0;
  }
}
