import type {
  ConsentStatus,
  FeatureOverride,
  Prisma,
  SubscriptionPlan,
  SubscriptionStatus,
} from "@prisma/client";
import { getPlanAnalysisCap } from "@/lib/billing/plans";
import { getOrCreateAppUser } from "@/lib/auth/get-or-create-app-user";
import { prisma } from "@/lib/prisma";

export type PlanTier = "starter" | "pro" | "team";
export type FeatureKey =
  | "basic_chat"
  | "uploads"
  | "at_a_glance"
  | "what_stands_out"
  | "vehicle_context"
  | "basic_pdf_export"
  | "supplement_lines"
  | "negotiation_draft"
  | "rebuttal_email"
  | "side_by_side_report"
  | "line_by_line_report"
  | "shop_management"
  | "pooled_usage";

export type ViewerAccess = {
  isAuthenticated: boolean;
  isPlatformAdmin: boolean;
  userId: string | null;
  clerkUserId: string | null;
  plan: PlanTier;
  featureFlags: Record<FeatureKey, boolean>;
  monthlyAnalysisLimit: number | null;
  monthlyAnalysisUsed: number;
  canRunAnalysis: boolean;
  dbUserId: string | null;
  activeSubscriptionId: string | null;
  activeSubscriptionStatus: SubscriptionStatus | null;
  activeShopId: string | null;
  consentStatus: ConsentStatus | null;
};

const PLAN_FEATURES: Record<PlanTier, Record<FeatureKey, boolean>> = {
  starter: {
    basic_chat: true,
    uploads: true,
    at_a_glance: true,
    what_stands_out: true,
    vehicle_context: true,
    basic_pdf_export: true,
    supplement_lines: false,
    negotiation_draft: false,
    rebuttal_email: false,
    side_by_side_report: false,
    line_by_line_report: false,
    shop_management: false,
    pooled_usage: false,
  },
  pro: {
    basic_chat: true,
    uploads: true,
    at_a_glance: true,
    what_stands_out: true,
    vehicle_context: true,
    basic_pdf_export: true,
    supplement_lines: true,
    negotiation_draft: true,
    rebuttal_email: true,
    side_by_side_report: true,
    line_by_line_report: true,
    shop_management: false,
    pooled_usage: false,
  },
  team: {
    basic_chat: true,
    uploads: true,
    at_a_glance: true,
    what_stands_out: true,
    vehicle_context: true,
    basic_pdf_export: true,
    supplement_lines: true,
    negotiation_draft: true,
    rebuttal_email: true,
    side_by_side_report: true,
    line_by_line_report: true,
    shop_management: true,
    pooled_usage: true,
  },
};

const ACTIVE_SUBSCRIPTION_STATUSES = new Set<SubscriptionStatus>([
  "ACTIVE",
  "TRIALING",
  "PAST_DUE",
]);

type SubscriptionWithRelations = Prisma.SubscriptionGetPayload<{
  include: {
    shop: true;
  };
}>;

type DbUserWithRelations = Prisma.UserGetPayload<{
  include: {
    consents: {
      orderBy: { acceptedAt: "desc" };
      take: 1;
    };
    subscriptions: {
      include: {
        shop: true;
      };
      orderBy: { createdAt: "desc" };
    };
    memberships: {
      include: {
        shop: {
          include: {
            featureOverrides: true;
            subscriptions: {
              include: {
                shop: true;
              };
              orderBy: { createdAt: "desc" };
            };
          };
        };
      };
    };
    featureOverrides: true;
  };
}>;

export function getFeatureFlagsForPlan(plan: PlanTier) {
  return PLAN_FEATURES[plan];
}

export function hasFeature(access: ViewerAccess, feature: FeatureKey) {
  return access.featureFlags[feature];
}

export async function ensureDbUser() {
  return getOrCreateAppUser();
}

export async function getViewerAccessByClerkUserId(
  clerkUserId: string | null | undefined
): Promise<ViewerAccess> {
  if (!clerkUserId) {
    return buildAnonymousAccess();
  }

  const dbUser = await prisma.user.findUnique({
    where: {
      clerkUserId,
    },
    include: {
      consents: {
        orderBy: {
          acceptedAt: "desc",
        },
        take: 1,
      },
      subscriptions: {
        include: {
          shop: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      },
      memberships: {
        include: {
          shop: {
            include: {
              featureOverrides: true,
              subscriptions: {
                include: {
                  shop: true,
                },
                orderBy: {
                  createdAt: "desc",
                },
              },
            },
          },
        },
      },
      featureOverrides: true,
    },
  });

  if (!dbUser) {
    return {
      ...buildAnonymousAccess(),
      isAuthenticated: true,
      isPlatformAdmin: false,
      clerkUserId,
    };
  }

  return buildAccessFromDbUser(dbUser);
}

export async function getCurrentViewerAccess() {
  const dbUser = await ensureDbUser();

  if (!dbUser) {
    return buildAnonymousAccess();
  }

  const hydratedUser = await prisma.user.findUnique({
    where: {
      id: dbUser.id,
    },
    include: {
      consents: {
        orderBy: {
          acceptedAt: "desc",
        },
        take: 1,
      },
      subscriptions: {
        include: {
          shop: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      },
      memberships: {
        include: {
          shop: {
            include: {
              featureOverrides: true,
              subscriptions: {
                include: {
                  shop: true,
                },
                orderBy: {
                  createdAt: "desc",
                },
              },
            },
          },
        },
      },
      featureOverrides: true,
    },
  });

  if (!hydratedUser) {
    return buildAnonymousAccess();
  }

  return buildAccessFromDbUser(hydratedUser);
}

export async function recordCompletedAnalysisUsage(access: ViewerAccess, metadata?: Prisma.JsonObject) {
  if (access.isPlatformAdmin) {
    return;
  }

  if (!access.dbUserId) {
    return;
  }

  await prisma.usageRecord.create({
    data: {
      userId: access.dbUserId,
      shopId: access.activeShopId,
      subscriptionId: access.activeSubscriptionId,
      kind: "ANALYSIS_COMPLETED",
      periodKey: getCurrentPeriodKey(),
      quantity: 1,
      metadata,
    },
  });
}

export function buildAnonymousAccess(): ViewerAccess {
  return {
    isAuthenticated: false,
    isPlatformAdmin: false,
    userId: null,
    clerkUserId: null,
    plan: "starter",
    featureFlags: {
      ...PLAN_FEATURES.starter,
      basic_chat: false,
      uploads: false,
      at_a_glance: false,
      what_stands_out: false,
      vehicle_context: false,
      basic_pdf_export: false,
    },
    monthlyAnalysisLimit: getPlanAnalysisCap("starter"),
    monthlyAnalysisUsed: 0,
    canRunAnalysis: false,
    dbUserId: null,
    activeSubscriptionId: null,
    activeSubscriptionStatus: null,
    activeShopId: null,
    consentStatus: null,
  };
}

async function buildAccessFromDbUser(dbUser: DbUserWithRelations): Promise<ViewerAccess> {
  const activeSubscription = pickActiveSubscription(dbUser);
  if (dbUser.isPlatformAdmin) {
    return {
      isAuthenticated: true,
      isPlatformAdmin: true,
      userId: dbUser.id,
      clerkUserId: dbUser.clerkUserId,
      plan: "team",
      featureFlags: {
        basic_chat: true,
        uploads: true,
        at_a_glance: true,
        what_stands_out: true,
        vehicle_context: true,
        basic_pdf_export: true,
        supplement_lines: true,
        negotiation_draft: true,
        rebuttal_email: true,
        side_by_side_report: true,
        line_by_line_report: true,
        shop_management: true,
        pooled_usage: true,
      },
      monthlyAnalysisLimit: null,
      monthlyAnalysisUsed: 0,
      canRunAnalysis: true,
      dbUserId: dbUser.id,
      activeSubscriptionId: activeSubscription?.id ?? null,
      activeSubscriptionStatus: activeSubscription?.status ?? null,
      activeShopId: activeSubscription?.shopId ?? dbUser.defaultShopId ?? null,
      consentStatus: dbUser.consents[0]?.status ?? null,
    };
  }

  const plan = mapSubscriptionPlan(activeSubscription?.plan);
  const activeShopId = activeSubscription?.shopId ?? dbUser.defaultShopId ?? null;
  const activeShop = dbUser.memberships.find((membership) => membership.shopId === activeShopId)?.shop ?? null;
  const featureOverrides = getActiveFeatureOverrides(
    dbUser.featureOverrides,
    activeShop?.featureOverrides ?? []
  );
  const featureFlags = applyFeatureOverrides(PLAN_FEATURES[plan], featureOverrides);
  const monthlyAnalysisLimit = resolveMonthlyAnalysisLimit(plan, featureOverrides);
  const monthlyAnalysisUsed = await prisma.usageRecord.aggregate({
    where: {
      kind: "ANALYSIS_COMPLETED",
      periodKey: getCurrentPeriodKey(),
      OR: [
        { userId: dbUser.id },
        ...(activeShopId ? [{ shopId: activeShopId }] : []),
      ],
    },
    _sum: {
      quantity: true,
    },
  });

  const used = monthlyAnalysisUsed._sum.quantity ?? 0;
  const canRunAnalysis = monthlyAnalysisLimit === null ? true : used < monthlyAnalysisLimit;

  return {
    isAuthenticated: true,
    isPlatformAdmin: false,
    userId: dbUser.id,
    clerkUserId: dbUser.clerkUserId,
    plan,
    featureFlags,
    monthlyAnalysisLimit,
    monthlyAnalysisUsed: used,
    canRunAnalysis,
    dbUserId: dbUser.id,
    activeSubscriptionId: activeSubscription?.id ?? null,
    activeSubscriptionStatus: activeSubscription?.status ?? null,
    activeShopId,
    consentStatus: dbUser.consents[0]?.status ?? null,
  };
}

function pickActiveSubscription(dbUser: DbUserWithRelations): SubscriptionWithRelations | null {
  const userSubscription = dbUser.subscriptions.find((subscription) =>
    ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)
  );
  if (userSubscription) {
    return userSubscription;
  }

  for (const membership of dbUser.memberships) {
    const shopSubscription = membership.shop.subscriptions.find((subscription) =>
      ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)
    );
    if (shopSubscription) {
      return shopSubscription;
    }
  }

  return null;
}

function mapSubscriptionPlan(plan: SubscriptionPlan | null | undefined): PlanTier {
  switch (plan) {
    case "PRO":
      return "pro";
    case "TEAM":
      return "team";
    default:
      return "starter";
  }
}

function getCurrentPeriodKey() {
  const now = new Date();
  const month = `${now.getUTCMonth() + 1}`.padStart(2, "0");
  return `${now.getUTCFullYear()}-${month}`;
}

function getActiveFeatureOverrides(
  userOverrides: FeatureOverride[],
  shopOverrides: FeatureOverride[]
) {
  const now = new Date();
  return [...shopOverrides, ...userOverrides].filter(
    (override) => !override.expiresAt || override.expiresAt > now
  );
}

function applyFeatureOverrides(
  baseFlags: Record<FeatureKey, boolean>,
  overrides: FeatureOverride[]
) {
  const nextFlags = { ...baseFlags };

  for (const override of overrides) {
    if (override.featureKey === "monthly_analysis_limit") {
      continue;
    }

    if (override.featureKey in nextFlags) {
      nextFlags[override.featureKey as FeatureKey] = override.enabled;
    }
  }

  return nextFlags;
}

function resolveMonthlyAnalysisLimit(plan: PlanTier, overrides: FeatureOverride[]) {
  const limitOverride = overrides
    .filter((override) => override.featureKey === "monthly_analysis_limit")
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];

  if (!limitOverride?.notes) {
    return getPlanAnalysisCap(plan);
  }

  const parsed = Number.parseInt(limitOverride.notes, 10);
  return Number.isFinite(parsed) ? parsed : getPlanAnalysisCap(plan);
}
