import { getPlanAnalysisCap, type BillingPlan } from "@/lib/billing/plans";
import {
  getCurrentViewerAccess,
  hasFeature,
  type ViewerAccess,
} from "@/lib/entitlements";
import { getUsageCount as getMeteredUsageCount } from "@/lib/usage";

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
  usageStatus: "ok" | "usage_limit_reached" | "trial_expired" | "upgrade_required";
};

export async function getCurrentEntitlements(): Promise<AccountEntitlements> {
  const access = await getCurrentViewerAccess();
  const entitlements = toAccountEntitlements(access);

  if (entitlements.isPlatformAdmin || !entitlements.dbUserId) {
    return entitlements;
  }

  const [uploadCount, exportCount] = await Promise.all([
    getMeteredUsageCount(entitlements.dbUserId, "FILE_UPLOAD"),
    getMeteredUsageCount(entitlements.dbUserId, "REPORT_EXPORT"),
  ]);

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

export function toAccountEntitlements(access: ViewerAccess): AccountEntitlements {
  if (access.isPlatformAdmin) {
    return {
      ...access,
      plan: "admin",
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
      usageStatus: "ok",
    };
  }

  const billingPlan = resolveBillingPlan(access);
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
    canUpload: hasFeature(access, "uploads"),
    uploadCap: getPlanUploadCap(billingPlan),
    uploadCount: 0,
    canExport: hasFeature(access, "basic_pdf_export"),
    exportCap: getPlanExportCap(billingPlan),
    exportCount: 0,
    canUseBasicExports: hasFeature(access, "basic_pdf_export"),
    canUseCustomerReport: hasFeature(access, "customer_report"),
    canUseRedactedChatExport: hasFeature(access, "redacted_chat_export"),
    canUseSupplementLines: hasFeature(access, "supplement_lines"),
    canUseNegotiationDraft: hasFeature(access, "negotiation_draft"),
    canUseRebuttalEmail: hasFeature(access, "rebuttal_email"),
    usageStatus,
  };
}

function resolveBillingPlan(access: ViewerAccess): BillingPlan {
  if (!access.isAuthenticated) {
    return "none";
  }

  if (access.plan === "team") {
    return "team";
  }

  if (access.activeSubscriptionStatus === "TRIALING") {
    return "trial";
  }

  if (access.plan === "pro" && access.activeSubscriptionId) {
    return "pro";
  }

  if (access.activeSubscriptionId) {
    return "starter";
  }

  return "none";
}

export function getPlanUploadCap(plan: BillingPlan): number | null {
  switch (plan) {
    case "starter":
      return 1;
    case "trial":
    case "pro":
    case "team":
      return null;
    case "none":
    default:
      return 0;
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
    case "none":
    default:
      return 0;
  }
}
