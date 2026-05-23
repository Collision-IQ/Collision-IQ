import type { Prisma } from "@prisma/client";
import type { RepairIntelligenceReport } from "@/lib/ai/types/analysis";
import { prisma } from "@/lib/prisma";

export type StoredAnalysisReport = {
  id: string;
  artifactIds: string[];
  createdAt: string;
  report: RepairIntelligenceReport;
  linkedEvidence: RepairIntelligenceReport["linkedEvidence"];
  ingestionMeta: RepairIntelligenceReport["ingestionMeta"];
};

type ReportOwnerScope = {
  ownerUserId: string;
  shopId?: string | null;
};

function resolveOwner(params: ReportOwnerScope) {
  if (params.shopId) {
    return {
      ownerType: "SHOP" as const,
      ownerId: params.shopId,
    };
  }

  return {
    ownerType: "USER" as const,
    ownerId: params.ownerUserId,
  };
}

function toStoredAnalysisReport(record: {
  id: string;
  createdAt: Date;
  report: Prisma.JsonValue;
  artifacts?: Array<{ attachmentId: string }>;
}): StoredAnalysisReport {
  return {
    id: record.id,
    artifactIds: (record.artifacts ?? []).map((entry) => entry.attachmentId),
    createdAt: record.createdAt.toISOString(),
    report: record.report as unknown as RepairIntelligenceReport,
    linkedEvidence:
      (record.report as RepairIntelligenceReport | null | undefined)?.linkedEvidence ?? [],
    ingestionMeta:
      (record.report as RepairIntelligenceReport | null | undefined)?.ingestionMeta ?? undefined,
  };
}

export async function saveAnalysisReport(params: {
  ownerUserId: string;
  shopId?: string | null;
  artifactIds: string[];
  report: RepairIntelligenceReport;
}): Promise<StoredAnalysisReport> {
  const owner = resolveOwner({
    ownerUserId: params.ownerUserId,
    shopId: params.shopId,
  });

  const created = await prisma.analysisReport.create({
    data: {
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      report: params.report as unknown as Prisma.InputJsonValue,
      artifacts: params.artifactIds.length
        ? {
            create: params.artifactIds.map((attachmentId) => ({
              attachmentId,
            })),
          }
        : undefined,
    },
    include: {
      artifacts: {
        select: {
          attachmentId: true,
        },
      },
    },
  });

  return toStoredAnalysisReport(created);
}

export async function updateAnalysisReport(params: {
  id: string;
  ownerUserId: string;
  shopId?: string | null;
  artifactIds: string[];
  report: RepairIntelligenceReport;
}): Promise<StoredAnalysisReport | null> {
  const owner = resolveOwner({
    ownerUserId: params.ownerUserId,
    shopId: params.shopId,
  });

  const existing = await prisma.analysisReport.findFirst({
    where: {
      id: params.id,
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
    },
    select: {
      id: true,
    },
  });

  if (!existing) {
    return null;
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.analysisReportArtifact.deleteMany({
      where: {
        reportId: params.id,
      },
    });

    return tx.analysisReport.update({
      where: {
        id: params.id,
      },
      data: {
        report: params.report as unknown as Prisma.InputJsonValue,
        artifacts: params.artifactIds.length
          ? {
              create: [...new Set(params.artifactIds)].map((attachmentId) => ({
                attachmentId,
              })),
            }
          : undefined,
      },
      include: {
        artifacts: {
          select: {
            attachmentId: true,
          },
        },
      },
    });
  });

  return toStoredAnalysisReport(updated);
}

export async function closeAnalysisReport(params: {
  id: string;
  ownerUserId: string;
  shopId?: string | null;
}): Promise<StoredAnalysisReport | null> {
  const existing = await getAnalysisReport(params.id, params);
  if (!existing) {
    return null;
  }

  const closedReport: RepairIntelligenceReport = {
    ...existing.report,
    ingestionMeta: {
      ...existing.report.ingestionMeta,
      activeCaseId: existing.id,
      active: false,
      closedAt: new Date().toISOString(),
    },
  };

  return updateAnalysisReport({
    id: params.id,
    ownerUserId: params.ownerUserId,
    shopId: params.shopId,
    artifactIds: existing.artifactIds,
    report: closedReport,
  });
}

export async function getAnalysisReport(
  id: string,
  scope: ReportOwnerScope
): Promise<StoredAnalysisReport | null> {
  const owner = resolveOwner(scope);
  const record = await prisma.analysisReport.findFirst({
    where: {
      id,
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
    },
    include: {
      artifacts: {
        select: {
          attachmentId: true,
        },
      },
    },
  });

  return record ? toStoredAnalysisReport(record) : null;
}
