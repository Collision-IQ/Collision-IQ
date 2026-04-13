import type { Prisma, Subscription, SubscriptionPlan, SubscriptionStatus, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AccountEntitlements } from "@/lib/billing/entitlements";
import { getPlanAnalysisCap, type BillingPlan } from "@/lib/billing/plans";

export class UsageAccessError extends Error {
  status: number;
  code: "upgrade_required" | "usage_limit_reached" | "trial_expired";

  constructor(
    code: "upgrade_required" | "usage_limit_reached" | "trial_expired",
    message: string,
    status = 403
  ) {
    super(message);
    this.name = "UsageAccessError";
    this.code = code;
    this.status = status;
  }
}

export function getCurrentUsagePeriodKey() {
  const now = new Date();
  const month = `${now.getUTCMonth() + 1}`.padStart(2, "0");
  return `${now.getUTCFullYear()}-${month}`;
}

function resolvePlan(plan: SubscriptionPlan | null | undefined, isPlatformAdmin: boolean): BillingPlan | "admin" {
  if (isPlatformAdmin) {
    return "admin";
  }

  switch (plan) {
    case "PRO":
      return "pro";
    case "TEAM":
      return "team";
    default:
      return "starter";
  }
}

function isTrialExpired(subscription: Subscription | null) {
  if (!subscription || subscription.status !== "TRIALING" || !subscription.currentPeriodEnd) {
    return false;
  }

  return subscription.currentPeriodEnd.getTime() < Date.now();
}

export async function getCompletedAnalysisUsage(params: {
  ownerUserId: string;
  shopId?: string | null;
  isPlatformAdmin?: boolean;
}) {
  if (params.isPlatformAdmin) {
    return 0;
  }

  const aggregate = await prisma.usageRecord.aggregate({
    where: {
      kind: "ANALYSIS_COMPLETED",
      periodKey: getCurrentUsagePeriodKey(),
      OR: [
        { userId: params.ownerUserId },
        ...(params.shopId ? [{ shopId: params.shopId }] : []),
      ],
    },
    _sum: {
      quantity: true,
    },
  });

  return aggregate._sum.quantity ?? 0;
}

export async function assertAnalysisAllowed(params: {
  user: User;
  subscription: Subscription | null;
}) {
  const plan = resolvePlan(params.subscription?.plan, params.user.isPlatformAdmin);
  const analysesUsedThisPeriod = await getCompletedAnalysisUsage({
    ownerUserId: params.user.id,
    shopId: params.subscription?.shopId ?? null,
    isPlatformAdmin: params.user.isPlatformAdmin,
  });

  if (params.user.isPlatformAdmin) {
    return {
      entitlements: {
        plan,
        subscriptionStatus: "ACTIVE" as SubscriptionStatus,
        trialState: "not_applicable" as const,
        analysesUsedThisPeriod,
        analysesRemaining: null,
        canRunAnalysis: true,
      },
    };
  }

  const cap = getPlanAnalysisCap(plan === "admin" ? "team" : plan);
  const analysesRemaining = Math.max(cap - analysesUsedThisPeriod, 0);
  const subscriptionStatus = params.subscription?.status ?? null;
  const trialExpired = isTrialExpired(params.subscription);
  const hasActivePaidAccess =
    subscriptionStatus === "ACTIVE" ||
    subscriptionStatus === "TRIALING" ||
    subscriptionStatus === "PAST_DUE";

  if (trialExpired) {
    throw new UsageAccessError(
      "trial_expired",
      "Your trial has expired. Upgrade to continue running analyses."
    );
  }

  if (!hasActivePaidAccess && plan === "starter" && analysesUsedThisPeriod >= cap) {
    throw new UsageAccessError(
      "usage_limit_reached",
      "You have reached the Starter analysis limit for this period."
    );
  }

  if (analysesRemaining <= 0) {
    throw new UsageAccessError(
      "usage_limit_reached",
      "You have reached your analysis limit for this period."
    );
  }

  return {
    entitlements: {
      plan,
      subscriptionStatus,
      trialState:
        subscriptionStatus === "TRIALING" ? "active" : trialExpired ? "expired" : "not_applicable",
      analysesUsedThisPeriod,
      analysesRemaining,
      canRunAnalysis: true,
    },
  };
}

export function assertAnalysisAllowedForEntitlements(entitlements: AccountEntitlements) {
  if (entitlements.isPlatformAdmin) {
    return {
      entitlements: {
        plan: entitlements.plan,
        subscriptionStatus:
          entitlements.activeSubscriptionStatus ?? ("ACTIVE" as SubscriptionStatus),
        trialState: "not_applicable" as const,
        analysesUsedThisPeriod: entitlements.analysisCount,
        analysesRemaining: null,
        canRunAnalysis: true,
      },
    };
  }

  if (!entitlements.canRunAnalysis) {
    if (entitlements.usageStatus === "trial_expired") {
      throw new UsageAccessError(
        "trial_expired",
        "Your trial has expired. Upgrade to continue running analyses."
      );
    }

    throw new UsageAccessError(
      "usage_limit_reached",
      "You have reached your analysis limit for this period."
    );
  }

  return {
    entitlements: {
      plan: entitlements.plan,
      subscriptionStatus: entitlements.activeSubscriptionStatus,
      trialState: entitlements.billingPlan === "trial" ? "active" : "not_applicable",
      analysesUsedThisPeriod: entitlements.analysisCount,
      analysesRemaining: entitlements.usage.remaining,
      canRunAnalysis: true,
    },
  };
}

export async function recordCompletedAnalysisUsage(params: {
  userId: string;
  analysisReportId: string;
  isPlatformAdmin?: boolean;
  metadataJson?: Record<string, unknown>;
}) {
  if (params.isPlatformAdmin) {
    return;
  }

  const latestSubscription = await prisma.subscription.findFirst({
    where: {
      OR: [{ userId: params.userId }, { shop: { ownerId: params.userId } }],
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  await prisma.usageRecord.create({
    data: {
      userId: params.userId,
      shopId: latestSubscription?.shopId ?? null,
      subscriptionId: latestSubscription?.id ?? null,
      kind: "ANALYSIS_COMPLETED",
      periodKey: getCurrentUsagePeriodKey(),
      quantity: 1,
      metadata: {
        ...(params.metadataJson as Prisma.InputJsonValue extends never ? never : Record<string, unknown>),
        analysisReportId: params.analysisReportId,
      } as Prisma.InputJsonValue,
    },
  });
}
