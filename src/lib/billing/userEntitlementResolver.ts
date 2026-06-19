export const MEMBERSHIP_UPGRADE_URL = "https://www.collision-iq.ai/technical-systems";
export const TRIAL_EXPIRED_MESSAGE =
  "Your 30-day trial has ended. You can continue with the free plan, or upgrade here: https://www.collision-iq.ai/technical-systems";
export const STARTER_PRO_FEATURE_MESSAGE =
  "This feature requires Pro access. You can review membership options here: https://www.collision-iq.ai/technical-systems";
export const FREE_PAID_FEATURE_MESSAGE =
  "This feature is available with a paid membership. View options here: https://www.collision-iq.ai/technical-systems";

const TRIAL_DAYS = 30;
const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;

export type ResolvedEntitlementPlan = "free" | "trial_pro" | "starter" | "pro" | "admin";
export type ResolvedEntitlementTier = "free" | "starter" | "pro" | "admin";

export type UserEntitlementInput = {
  user?: {
    id?: string | null;
    createdAt?: Date | string | null;
    isPlatformAdmin?: boolean | null;
  } | null;
  dbRecord?: {
    createdAt?: Date | string | null;
    isPlatformAdmin?: boolean | null;
    trialStartedAt?: Date | string | null;
  } | null;
  stripeRecord?: {
    plan?: string | null;
    status?: string | null;
    currentPeriodEnd?: Date | string | null;
  } | null;
  clerkMetadata?: {
    plan?: string | null;
    role?: string | null;
    isAdmin?: boolean | null;
    trialStartedAt?: Date | string | null;
  } | null;
  now?: Date | string | null;
};

export type ResolvedUserEntitlement = {
  plan: ResolvedEntitlementPlan;
  effectiveTier: ResolvedEntitlementTier;
  trialActive: boolean;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  trialExpired: boolean;
  paidActive: boolean;
  admin: boolean;
  upgradeUrl: typeof MEMBERSHIP_UPGRADE_URL;
  limits: {
    monthlyAnalyses: number | null;
    uploadCap: number | null;
    maxUploadsPerReview: number | null;
    exportCap: number | null;
  };
  features: {
    chat: boolean;
    upload: boolean;
    snapshotExport: boolean;
    proReports: boolean;
    customerReport: boolean;
    admin: boolean;
  };
  reason: string;
};

export function resolveUserEntitlement(
  user?: UserEntitlementInput["user"],
  dbRecord?: UserEntitlementInput["dbRecord"],
  stripeRecord?: UserEntitlementInput["stripeRecord"],
  clerkMetadata?: UserEntitlementInput["clerkMetadata"],
  nowInput?: UserEntitlementInput["now"]
): ResolvedUserEntitlement {
  const now = coerceDate(nowInput) ?? new Date();
  const admin = Boolean(user?.isPlatformAdmin || dbRecord?.isPlatformAdmin || clerkMetadata?.isAdmin || clerkMetadata?.role === "admin");
  if (admin) {
    return buildResolvedEntitlement({
      plan: "admin",
      effectiveTier: "admin",
      trialStartedAt: null,
      trialEndsAt: null,
      trialActive: false,
      trialExpired: false,
      paidActive: false,
      admin: true,
      reason: "admin_override",
    });
  }

  const stripeStatus = normalizeStatus(stripeRecord?.status);
  const stripePlan = normalizePlan(stripeRecord?.plan ?? clerkMetadata?.plan);
  const paidActive = stripeStatus === "active" || stripeStatus === "past_due";
  if (paidActive && stripePlan === "starter") {
    return buildResolvedEntitlement({
      plan: "starter",
      effectiveTier: "starter",
      trialStartedAt: null,
      trialEndsAt: null,
      trialActive: false,
      trialExpired: false,
      paidActive: true,
      admin: false,
      reason: "paid_starter_subscription",
    });
  }

  if (paidActive && (stripePlan === "pro" || stripePlan === "team")) {
    return buildResolvedEntitlement({
      plan: "pro",
      effectiveTier: "pro",
      trialStartedAt: null,
      trialEndsAt: null,
      trialActive: false,
      trialExpired: false,
      paidActive: true,
      admin: false,
      reason: stripePlan === "team" ? "paid_team_subscription_pro_effective" : "paid_pro_subscription",
    });
  }

  const trialStarted = coerceDate(clerkMetadata?.trialStartedAt) ?? coerceDate(dbRecord?.trialStartedAt) ?? coerceDate(dbRecord?.createdAt) ?? coerceDate(user?.createdAt);
  const trialEnds = trialStarted ? new Date(trialStarted.getTime() + TRIAL_MS) : null;
  const stripeTrialActive = stripeStatus === "trialing" && !isPast(coerceDate(stripeRecord?.currentPeriodEnd), now);
  const createdTrialActive = Boolean(trialStarted && trialEnds && now.getTime() < trialEnds.getTime());
  const trialActive = stripeTrialActive || createdTrialActive;

  if (trialActive) {
    return buildResolvedEntitlement({
      plan: "trial_pro",
      effectiveTier: "pro",
      trialStartedAt: trialStarted ? trialStarted.toISOString() : null,
      trialEndsAt: trialEnds ? trialEnds.toISOString() : coerceDate(stripeRecord?.currentPeriodEnd)?.toISOString() ?? null,
      trialActive: true,
      trialExpired: false,
      paidActive: false,
      admin: false,
      reason: stripeTrialActive ? "stripe_trialing_subscription" : "new_user_30_day_trial",
    });
  }

  const trialExpired = Boolean(trialStarted && trialEnds && now.getTime() >= trialEnds.getTime());
  return buildResolvedEntitlement({
    plan: "free",
    effectiveTier: "free",
    trialStartedAt: trialStarted ? trialStarted.toISOString() : null,
    trialEndsAt: trialEnds ? trialEnds.toISOString() : null,
    trialActive: false,
    trialExpired,
    paidActive: false,
    admin: false,
    reason: trialExpired ? "trial_expired_free_access" : "free_access",
  });
}

export function getEntitlementUpgradeMessage(params: {
  plan?: ResolvedEntitlementPlan | string | null;
  trialExpired?: boolean | null;
  requiresPro?: boolean | null;
}) {
  if (params.trialExpired) return TRIAL_EXPIRED_MESSAGE;
  if (params.requiresPro && params.plan === "starter") return STARTER_PRO_FEATURE_MESSAGE;
  return FREE_PAID_FEATURE_MESSAGE;
}

function buildResolvedEntitlement(params: Omit<ResolvedUserEntitlement, "upgradeUrl" | "limits" | "features">): ResolvedUserEntitlement {
  return {
    ...params,
    upgradeUrl: MEMBERSHIP_UPGRADE_URL,
    limits: limitsForTier(params.plan, params.effectiveTier),
    features: featuresForTier(params.effectiveTier),
  };
}

function limitsForTier(plan: ResolvedEntitlementPlan, tier: ResolvedEntitlementTier): ResolvedUserEntitlement["limits"] {
  if (tier === "admin") {
    return { monthlyAnalyses: null, uploadCap: null, maxUploadsPerReview: null, exportCap: null };
  }
  if (tier === "pro") {
    return { monthlyAnalyses: 200, uploadCap: 100, maxUploadsPerReview: 6, exportCap: null };
  }
  if (plan === "starter") {
    return { monthlyAnalyses: 10, uploadCap: null, maxUploadsPerReview: 1, exportCap: 1 };
  }
  return { monthlyAnalyses: 5, uploadCap: 5, maxUploadsPerReview: 1, exportCap: 0 };
}

function featuresForTier(tier: ResolvedEntitlementTier): ResolvedUserEntitlement["features"] {
  return {
    chat: true,
    upload: tier !== "free" || true,
    snapshotExport: tier === "starter" || tier === "pro" || tier === "admin",
    proReports: tier === "pro" || tier === "admin",
    customerReport: tier === "pro" || tier === "admin",
    admin: tier === "admin",
  };
}

function normalizeStatus(value?: string | null) {
  return value?.trim().toLowerCase() ?? null;
}

function normalizePlan(value?: string | null): "starter" | "pro" | "team" | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "starter" || normalized === "start") return "starter";
  if (normalized === "pro" || normalized === "trial") return "pro";
  if (normalized === "team" || normalized === "enterprise") return "team";
  return null;
}

function coerceDate(value?: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isPast(value: Date | null, now: Date) {
  return value ? value.getTime() <= now.getTime() : false;
}
