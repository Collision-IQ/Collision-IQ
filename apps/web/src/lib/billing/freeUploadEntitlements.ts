import type { Prisma, UsageKind } from "@prisma/client";
import type { AccountEntitlements } from "@/lib/billing/entitlements";
import { prisma } from "@/lib/prisma";
import { FREE_UPLOAD_BATCH_LIMIT_MESSAGE } from "@/lib/uploadSafety/uploadLimits";

export const FREE_MONTHLY_UPLOAD_LIMIT = 3;
export const FREE_UPLOAD_LIMIT_MESSAGE =
  "You’ve used your 3 free uploads for this month. Upgrade to continue uploading files, or try again next month.";
export const FREE_UPLOAD_BATCH_MESSAGE = FREE_UPLOAD_BATCH_LIMIT_MESSAGE;

const ROLLING_UPLOAD_WINDOW_DAYS = 30;

type UsageRecordAggregateDelegate = {
  aggregate(args: {
    where: {
      userId: string;
      kind: UsageKind;
      createdAt: {
        gte: Date;
      };
    };
    _sum: {
      quantity: true;
    };
  }): Promise<{ _sum: { quantity: number | null } | null }>;
};

type UsageRecordCreateDelegate = {
  create(args: {
    data: {
      userId: string;
      kind: UsageKind;
      periodKey: string;
      quantity: number;
      metadata: Prisma.InputJsonValue;
    };
  }): Promise<unknown>;
};

export function isFreeUploadEntitlement(
  entitlements: Pick<AccountEntitlements, "billingPlan" | "plan" | "entitlementSource" | "isPlatformAdmin">
) {
  return (
    !entitlements.isPlatformAdmin &&
    entitlements.entitlementSource === "locked" &&
    entitlements.billingPlan === "none" &&
    entitlements.plan === "none"
  );
}

export function getFreeUploadRollingWindowStart(now = new Date()) {
  return new Date(now.getTime() - ROLLING_UPLOAD_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

export async function getFreeUploadUsageCount(params: {
  userId: string;
  now?: Date;
  usageRecord?: UsageRecordAggregateDelegate;
}) {
  const usageRecord = params.usageRecord ?? prisma.usageRecord;
  const aggregate = await usageRecord.aggregate({
    where: {
      userId: params.userId,
      kind: "FILE_UPLOAD" as UsageKind,
      createdAt: {
        gte: getFreeUploadRollingWindowStart(params.now),
      },
    },
    _sum: {
      quantity: true,
    },
  });

  return aggregate._sum?.quantity ?? 0;
}

export function getFreeUploadUsagePeriodKey(now = new Date()) {
  const month = `${now.getUTCMonth() + 1}`.padStart(2, "0");
  return `${now.getUTCFullYear()}-${month}`;
}

export async function recordFreeUploadUsage(params: {
  userId: string;
  metadataJson?: Record<string, unknown>;
  now?: Date;
  usageRecord?: UsageRecordCreateDelegate;
}) {
  const usageRecord = params.usageRecord ?? prisma.usageRecord;
  return usageRecord.create({
    data: {
      userId: params.userId,
      kind: "FILE_UPLOAD" as UsageKind,
      periodKey: getFreeUploadUsagePeriodKey(params.now),
      quantity: 1,
      metadata: (params.metadataJson ?? {}) as Prisma.InputJsonValue,
    },
  });
}

export function isPdfOrPhotoUpload(params: {
  filename?: string | null;
  type?: string | null;
}) {
  const mime = params.type?.toLowerCase().trim() ?? "";
  const filename = params.filename?.toLowerCase().trim() ?? "";

  if (mime === "application/pdf" || mime.startsWith("image/")) {
    return true;
  }

  return /\.(pdf|jpe?g|png|webp|heic)$/i.test(filename);
}

export function resolveFreeUploadQuotaStatus(params: {
  used: number;
  requestedAcceptedCount?: number;
}) {
  const requestedAcceptedCount = Math.max(params.requestedAcceptedCount ?? 1, 0);
  const remaining = Math.max(FREE_MONTHLY_UPLOAD_LIMIT - params.used, 0);
  const allowed = remaining >= requestedAcceptedCount && requestedAcceptedCount > 0;

  return {
    allowed,
    used: params.used,
    remaining,
    limit: FREE_MONTHLY_UPLOAD_LIMIT,
    message: allowed ? null : FREE_UPLOAD_LIMIT_MESSAGE,
  };
}

export function evaluateFreeUploadRequest(params: {
  files: Array<{ filename?: string | null; type?: string | null }>;
  used: number;
}) {
  if (params.files.length > 1) {
    return {
      allowed: false,
      code: "FREE_UPLOAD_BATCH_LIMIT" as const,
      message: FREE_UPLOAD_BATCH_MESSAGE,
      countedUploadCount: 0,
    };
  }

  const file = params.files[0];
  if (!file) {
    return {
      allowed: false,
      code: "NO_FILE" as const,
      message: "NO_FILE",
      countedUploadCount: 0,
    };
  }

  if (!isPdfOrPhotoUpload(file)) {
    return {
      allowed: false,
      code: "FREE_UPLOAD_FILE_TYPE_LIMIT" as const,
      message: "Free accounts can upload PDF or photo files only.",
      countedUploadCount: 0,
    };
  }

  const quota = resolveFreeUploadQuotaStatus({
    used: params.used,
    requestedAcceptedCount: 1,
  });

  if (!quota.allowed) {
    return {
      allowed: false,
      code: "FREE_MONTHLY_UPLOAD_LIMIT_REACHED" as const,
      message: FREE_UPLOAD_LIMIT_MESSAGE,
      countedUploadCount: 0,
    };
  }

  return {
    allowed: true,
    code: null,
    message: null,
    countedUploadCount: 1,
  };
}
