import type { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import {
  getCurrentEntitlements,
  getPlanUploadBatchLimit,
  toAccountEntitlements,
  type AccountEntitlements,
  type EntitlementResolutionContext,
} from "@/lib/billing/entitlements";
import { PRO_TRIAL_DAYS, type BillingPlan } from "@/lib/billing/plans";
import type { ViewerAccess } from "@/lib/entitlements";
import { prisma } from "@/lib/prisma";

const UPLOAD_ACTIVE_STATUSES = new Set<SubscriptionStatus>([
  "ACTIVE",
  "TRIALING",
  "PAST_DUE",
]);

export type ProductEntitlementResolutionContext = EntitlementResolutionContext;
export type ProductEntitlements = AccountEntitlements;

export async function getCurrentProductEntitlements(
  params: ProductEntitlementResolutionContext
) {
  return getCurrentEntitlements(params);
}

export function resolveProductEntitlements(
  access: ViewerAccess,
  params: ProductEntitlementResolutionContext
) {
  return toAccountEntitlements(access, params);
}

export function canUploadFiles(entitlements: Pick<ProductEntitlements, "canUpload">) {
  return entitlements.canUpload;
}

export function getMaxUploadsPerReview(plan: BillingPlan) {
  return getPlanUploadBatchLimit(plan);
}

export function resolveProductTrialActive(access: {
  activeSubscriptionStatus?: SubscriptionStatus | null;
  activeSubscriptionId?: string | null;
  createdAt?: Date | string | null;
  plan?: BillingPlan | null;
}) {
  if (access.activeSubscriptionStatus === "TRIALING") {
    return true;
  }

  if (access.activeSubscriptionId || access.activeSubscriptionStatus === "ACTIVE") {
    return false;
  }

  if (access.plan && access.plan !== "pro" && access.plan !== "trial") {
    return false;
  }

  if (!access.createdAt) {
    return false;
  }

  const createdAtMs = new Date(access.createdAt).getTime();
  if (Number.isNaN(createdAtMs)) {
    return false;
  }

  return Date.now() - createdAtMs < PRO_TRIAL_DAYS * 24 * 60 * 60 * 1000;
}

export async function getCurrentSubscriptionTierForUser(userId: string): Promise<BillingPlan | null> {
  const subscription = await prisma.subscription.findFirst({
    where: {
      userId,
      status: {
        in: [...UPLOAD_ACTIVE_STATUSES],
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      plan: true,
      status: true,
    },
  });

  if (!subscription) {
    return null;
  }

  if (subscription.status === "TRIALING") {
    return "trial";
  }

  return mapSubscriptionPlanToBillingPlan(subscription.plan);
}

function mapSubscriptionPlanToBillingPlan(plan: SubscriptionPlan): BillingPlan {
  switch (plan) {
    case "PRO":
      return "pro";
    case "TEAM":
      return "team";
    case "STARTER":
    default:
      return "starter";
  }
}
