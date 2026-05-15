import { prisma } from "@/lib/prisma";

type SupportedUsageKind =
  | "ANALYSIS_COMPLETED"
  | "FILE_UPLOAD"
  | "REPORT_EXPORT"
  | "CHAT_EXPORT";

type UsageCounterRecord = {
  count: number;
};

type UsageCounterDelegate = {
  upsert(args: {
    where: {
      userId_kind: {
        userId: string;
        kind: SupportedUsageKind;
      };
    };
    update: {
      count: {
        increment: number;
      };
      updatedAt: Date;
    };
    create: {
      id: string;
      userId: string;
      kind: SupportedUsageKind;
      count: number;
    };
  }): Promise<unknown>;
  findUnique(args: {
    where: {
      userId_kind: {
        userId: string;
        kind: SupportedUsageKind;
      };
    };
  }): Promise<UsageCounterRecord | null>;
};

function getUsageCounterDelegate(): UsageCounterDelegate | null {
  try {
    const candidate = (prisma as unknown as { usageCounter?: unknown }).usageCounter;
    if (!candidate) {
      return null;
    }

    if (typeof candidate !== "object") {
      return null;
    }

    const delegate = candidate as Partial<UsageCounterDelegate>;
    if (
      typeof delegate.upsert !== "function" ||
      typeof delegate.findUnique !== "function"
    ) {
      return null;
    }

    return delegate as UsageCounterDelegate;
  } catch (error) {
    console.error("[usage:getUsageCounterDelegate] fail-open", { error });
    return null;
  }
}

export async function incrementUsage(userId: string, kind: SupportedUsageKind) {
  const usageCounter = getUsageCounterDelegate();
  if (!usageCounter) {
    console.error("[usage:incrementUsage] fail-open", {
      reason: "usageCounter delegate unavailable",
      userId,
      kind,
    });
    return null;
  }

  try {
    return await usageCounter.upsert({
      where: {
        userId_kind: {
          userId,
          kind,
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
        kind,
        count: 1,
      },
    });
  } catch (error) {
    console.error("[usage:incrementUsage] fail-open", {
      userId,
      kind,
      error,
    });
    return null;
  }
}

export async function getUsageCount(userId: string, kind: SupportedUsageKind) {
  const usageCounter = getUsageCounterDelegate();
  if (!usageCounter) {
    console.error("[usage:getUsageCount] fail-open", {
      reason: "usageCounter delegate unavailable",
      userId,
      kind,
    });
    return 0;
  }

  try {
    const record = await usageCounter.findUnique({
      where: {
        userId_kind: {
          userId,
          kind,
        },
      },
    });

    return record?.count ?? 0;
  } catch (error) {
    console.error("[usage:getUsageCount] fail-open", {
      userId,
      kind,
      error,
    });
    return 0;
  }
}
