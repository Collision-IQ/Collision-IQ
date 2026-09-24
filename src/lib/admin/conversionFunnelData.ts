import "server-only";
import { prisma } from "@/lib/prisma";
import {
  buildConversionFunnel,
  type ConversionFunnel,
  type FunnelAccountInput,
} from "./conversionFunnel";

/** Signup-cohort windows offered on /admin/funnel; null = all time. */
export const FUNNEL_WINDOWS_DAYS = [30, 90, 365, null] as const;

function earliest(dates: Array<Date | null | undefined>): Date | null {
  let result: Date | null = null;
  for (const date of dates) {
    if (date && (!result || date < result)) result = date;
  }
  return result;
}

/**
 * Loads the funnel for accounts that signed up inside the window. Platform
 * admins are excluded: their own testing would otherwise read as customers.
 */
export async function loadConversionFunnel(params: {
  windowDays: number | null;
  now: Date;
}): Promise<ConversionFunnel> {
  const since =
    params.windowDays === null
      ? undefined
      : new Date(params.now.getTime() - params.windowDays * 24 * 60 * 60 * 1000);

  const users = await prisma.user.findMany({
    where: { isPlatformAdmin: false, ...(since ? { createdAt: { gte: since } } : {}) },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      createdAt: true,
      memberships: { select: { shopId: true } },
      subscriptions: {
        select: {
          stripeCustomerId: true,
          stripeSubscriptionId: true,
          status: true,
          createdAt: true,
          currentPeriodStart: true,
        },
      },
    },
  });

  const userIds = users.map((user) => user.id);
  const shopIds = [...new Set(users.flatMap((user) => user.memberships.map((m) => m.shopId)))];
  const ownerFilter = {
    OR: [
      { ownerType: "USER" as const, ownerId: { in: userIds } },
      ...(shopIds.length ? [{ ownerType: "SHOP" as const, ownerId: { in: shopIds } }] : []),
    ],
  };

  const [uploads, reports, valueIq] = userIds.length
    ? await Promise.all([
        prisma.uploadedAttachment.groupBy({
          by: ["ownerType", "ownerId"],
          where: ownerFilter,
          _min: { createdAt: true },
        }),
        prisma.analysisReport.groupBy({
          by: ["ownerType", "ownerId"],
          where: ownerFilter,
          _min: { createdAt: true },
        }),
        prisma.dvValuationRequest.groupBy({
          by: ["userId"],
          where: { userId: { in: userIds }, paidAt: { not: null } },
          _min: { paidAt: true },
        }),
      ])
    : [[], [], []];

  const firstByOwner = (rows: typeof uploads) =>
    new Map(rows.map((row) => [`${row.ownerType}:${row.ownerId}`, row._min.createdAt]));
  const firstUpload = firstByOwner(uploads);
  const firstReport = firstByOwner(reports);
  const valueIqPaid = new Map(valueIq.map((row) => [row.userId, row._min.paidAt]));

  const inputs: FunnelAccountInput[] = users.map((user) => {
    const ownerKeys = [
      `USER:${user.id}`,
      ...user.memberships.map((membership) => `SHOP:${membership.shopId}`),
    ];
    const confirmed = user.subscriptions.filter((sub) => sub.stripeSubscriptionId);
    const latestConfirmed = [...confirmed].sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
    )[0];
    return {
      userId: user.id,
      email: user.email,
      name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
      signedUpAt: user.createdAt,
      firstUploadAt: earliest(ownerKeys.map((key) => firstUpload.get(key))),
      firstReportAt: earliest(ownerKeys.map((key) => firstReport.get(key))),
      checkoutStartedAt: earliest(
        user.subscriptions.filter((sub) => sub.stripeCustomerId).map((sub) => sub.createdAt)
      ),
      subscribedAt: earliest(confirmed.map((sub) => sub.currentPeriodStart ?? sub.createdAt)),
      subscriptionStatus: latestConfirmed?.status ?? null,
      valueIqPaidAt: valueIqPaid.get(user.id) ?? null,
    };
  });

  return buildConversionFunnel(inputs, params.now);
}
