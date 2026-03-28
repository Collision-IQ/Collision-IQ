import type { Prisma } from "@prisma/client";
import type { RepairIntelligenceReport } from "@/lib/ai/types/analysis";
import { prisma } from "@/lib/prisma";

export type StoredAnalysisReport = {
  id: string;
  artifactIds: string[];
  createdAt: string;
  report: RepairIntelligenceReport;
};

type ReportOwnerScope = {
  ownerUserId: string;
  shopId?: string | null;
};

function toStoredAnalysisReport(record: {
  id: string;
  createdAt: Date;
  reportJson: Prisma.JsonValue;
  artifacts?: Array<{ artifactId: string }>;
}): StoredAnalysisReport {
  return {
    id: record.id,
    artifactIds: (record.artifacts ?? []).map((entry) => entry.artifactId),
    createdAt: record.createdAt.toISOString(),
    report: record.reportJson as RepairIntelligenceReport,
  };
}

export async function saveAnalysisReport(params: {
  ownerUserId: string;
  shopId?: string | null;
  artifactIds: string[];
  report: RepairIntelligenceReport;
}): Promise<StoredAnalysisReport> {
  const created = await prisma.storedAnalysisReport.create({
    data: {
      ownerUserId: params.ownerUserId,
      shopId: params.shopId ?? null,
      reportJson: params.report as Prisma.InputJsonValue,
      artifacts: params.artifactIds.length
        ? {
            create: params.artifactIds.map((artifactId) => ({
              artifactId,
            })),
          }
        : undefined,
    },
    include: {
      artifacts: {
        select: {
          artifactId: true,
        },
      },
    },
  });

  return toStoredAnalysisReport(created);
}

export async function getAnalysisReport(
  id: string,
  scope: ReportOwnerScope
): Promise<StoredAnalysisReport | null> {
  const record = await prisma.storedAnalysisReport.findFirst({
    where: {
      id,
      ownerUserId: scope.ownerUserId,
    },
    include: {
      artifacts: {
        select: {
          artifactId: true,
        },
      },
    },
  });

  return record ? toStoredAnalysisReport(record) : null;
}
