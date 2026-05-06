import { getPlanAnalysisCap, type BillingPlan } from "@/lib/billing/plans";
import {
  getCurrentViewerAccess,
  hasFeature,
  type ViewerAccess,
} from "@/lib/entitlements";
import { getUsageCount as getMeteredUsageCount } from "@/lib/usage";
import { isPlatformAdminEmail } from "@/lib/auth/platform-admin";

const TRIAL_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export type EntitlementResolutionContext = {
  userEmail?: string | null;
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
  maxUploadsPerReview: number | null;
  usageStatus: "ok" | "usage_limit_reached" | "trial_expired" | "upgrade_required";
};

export async function getCurrentEntitlements(
  params?: EntitlementResolutionContext
): Promise<AccountEntitlements> {
  const access = await getCurrentViewerAccess();
  const entitlements = toAccountEntitlements(access, {
    userEmail: params?.userEmail,
    trialActive: params?.trialActive,
    subscriptionTier: params?.subscriptionTier,
    isPlatformAdmin: params?.isPlatformAdmin,
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
  const isEnvAdmin = isPlatformAdminEmail(params?.userEmail ?? null);
  const trialActive = resolveEffectiveTrialActive(access, params?.trialActive);
  const contextAdmin = Boolean(params?.isPlatformAdmin);

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
      trialActive,
      maxUploadsPerReview: null,
      usageStatus: "ok",
    };
  }

  const billingPlan = resolveBillingPlan(access, {
    subscriptionTier: params?.subscriptionTier,
    trialActive,
  });
  const analysisCap = getPlanAnalysisCap(billingPlan);
  const analysisCount = access.monthlyAnalysisUsed;
  const capped = true;
  const remaining = Math.max(analysisCap - analysisCount, 0);

  const usageStatus = !access.isAuthenticated
    ? "upgrade_required"
    : billingPlan === "none"
      ? "upgrade_required"
    : !access.canRunAnalysis && billingPlan === "trial"
      ? "trial_expired"
      : !access.canRunAnalysis
        ? "usage_limit_reached"
        : "ok";

  const subscriptionStatus =
    access.activeSubscriptionStatus === "ACTIVE" || access.activeSubscriptionStatus === "TRIALING"
      ? "active"
      : "inactive";

  return {
    ...access,
    plan: billingPlan,
    subscriptionStatus,
    usage: {
      capped,
      used: analysisCount,
      remaining,
    },
    billingPlan,
    analysisCap,
    analysisCount,
    canUpload: billingPlan !== "none" || trialActive || hasFeature(access, "uploads"),
    uploadCap: getPlanUploadCap(billingPlan),
    uploadCount: 0,
    canExport: billingPlan !== "none" || trialActive || hasFeature(access, "basic_pdf_export"),
    exportCap: getPlanExportCap(billingPlan),
    exportCount: 0,
    canUseBasicExports: billingPlan !== "none" || trialActive || hasFeature(access, "basic_pdf_export"),
    canUseCustomerReport: hasFeature(access, "customer_report"),
    canUseRedactedChatExport: hasFeature(access, "redacted_chat_export"),
    canUseSupplementLines: hasFeature(access, "supplement_lines"),
    canUseNegotiationDraft: hasFeature(access, "negotiation_draft"),
    canUseRebuttalEmail: hasFeature(access, "rebuttal_email"),
    canUseChatOnly: billingPlan === "trial" || billingPlan === "pro" || billingPlan === "team",
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
    maxUploadsPerReview: getPlanUploadCap(billingPlan),
    usageStatus,
  };
}

function resolveBillingPlan(
  access: ViewerAccess,
  params?: { subscriptionTier?: BillingPlan | "admin" | null; trialActive?: boolean }
): BillingPlan {
  if (!access.isAuthenticated) {
    return "none";
  }

  if (
    params?.trialActive &&
    !access.activeSubscriptionId &&
    !access.activeSubscriptionStatus
  ) {
    return "trial";
  }

  if (params?.subscriptionTier && params.subscriptionTier !== "admin") {
    return params.subscriptionTier;
  }

  if (access.plan === "none") {
    return "none";
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

  return "none";
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

  if (access.plan !== "pro") {
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

export function getPlanUploadCap(plan: BillingPlan): number | null {
  switch (plan) {
    case "starter":
      return 1;
    case "pro":
    case "team":
    case "trial":
      return null;
    case "none":
    default:
      return 0;
  }
}

export function getPlanExportCap(plan: BillingPlan): number | null {
  switch (plan) {
    case "starter":
    case "trial":
    case "pro":
      return 1;
    case "team":
      return null;
    case "none":
    default:
      return 0;
  }
}
