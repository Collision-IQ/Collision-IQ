import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export function getCurrentUsagePeriodKey() {
  const now = new Date();
  const month = `${now.getUTCMonth() + 1}`.padStart(2, "0");
  return `${now.getUTCFullYear()}-${month}`;
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

export async function recordCompletedAnalysisUsage(params: {
  ownerUserId: string;
  shopId?: string | null;
  subscriptionId?: string | null;
  isPlatformAdmin?: boolean;
  metadata?: Record<string, unknown>;
}) {
  if (params.isPlatformAdmin) {
    return;
  }

  await prisma.usageRecord.create({
    data: {
      userId: params.ownerUserId,
      shopId: params.shopId ?? null,
      subscriptionId: params.subscriptionId ?? null,
      kind: "ANALYSIS_COMPLETED",
      periodKey: getCurrentUsagePeriodKey(),
      quantity: 1,
      metadata: params.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}
