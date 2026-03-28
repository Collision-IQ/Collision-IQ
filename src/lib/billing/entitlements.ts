import { getPlanAnalysisCap, type BillingPlan } from "@/lib/billing/plans";
import {
  getCurrentViewerAccess,
  hasFeature,
  type ViewerAccess,
} from "@/lib/entitlements";

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
  canUseBasicExports: boolean;
  canUseSupplementLines: boolean;
  canUseNegotiationDraft: boolean;
  canUseRebuttalEmail: boolean;
  canUseSideBySideReport: boolean;
  canUseLineByLineReport: boolean;
  usageStatus: "ok" | "usage_limit_reached" | "trial_expired" | "upgrade_required";
};

export async function getCurrentEntitlements(): Promise<AccountEntitlements> {
  const access = await getCurrentViewerAccess();
  return toAccountEntitlements(access);
}

export function canRunAnalysis(entitlements: AccountEntitlements) {
  return entitlements.canRunAnalysis;
}

export function canUseBasicExports(entitlements: AccountEntitlements) {
  return entitlements.canUseBasicExports;
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

export function canUseSideBySideReport(entitlements: AccountEntitlements) {
  return entitlements.canUseSideBySideReport;
}

export function canUseLineByLineReport(entitlements: AccountEntitlements) {
  return entitlements.canUseLineByLineReport;
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
      canUseBasicExports: true,
      canUseSupplementLines: true,
      canUseNegotiationDraft: true,
      canUseRebuttalEmail: true,
      canUseSideBySideReport: true,
      canUseLineByLineReport: true,
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
    canUseBasicExports: hasFeature(access, "basic_pdf_export"),
    canUseSupplementLines: hasFeature(access, "supplement_lines"),
    canUseNegotiationDraft: hasFeature(access, "negotiation_draft"),
    canUseRebuttalEmail: hasFeature(access, "rebuttal_email"),
    canUseSideBySideReport: hasFeature(access, "side_by_side_report"),
    canUseLineByLineReport: hasFeature(access, "line_by_line_report"),
    usageStatus,
  };
}

function resolveBillingPlan(access: ViewerAccess): BillingPlan {
  if (!access.isAuthenticated) {
    return "starter";
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

  return "starter";
}
