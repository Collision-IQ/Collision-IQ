import { UsageKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type SupportedUsageKind = UsageKind | "FILE_UPLOAD" | "REPORT_EXPORT" | "CHAT_EXPORT";

export async function incrementUsage(userId: string, kind: SupportedUsageKind) {
  return prisma.usageCounter.upsert({
    where: {
      userId_kind: {
        userId,
        kind: kind as UsageKind,
      },
    },
    update: {
      count: {
        increment: 1,
      },
      updatedAt: new Date(),
    },
    create: {
      id: `${userId}_${kind}`,
      userId,
      kind: kind as UsageKind,
      count: 1,
    },
  });
}

export async function getUsageCount(userId: string, kind: SupportedUsageKind) {
  const record = await prisma.usageCounter.findUnique({
    where: {
      userId_kind: {
        userId,
        kind: kind as UsageKind,
      },
    },
  });

  return record?.count ?? 0;
}