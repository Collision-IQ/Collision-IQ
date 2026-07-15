import "server-only";
import { prisma } from "@/lib/prisma";
import { rankErrorTargets } from "./errorLedger";

/**
 * Collision Learning Engine — dashboard metrics assembly (admin-only).
 */

export type LearningDashboardMetrics = {
  generatedAt: string;
  itemCounts: Record<string, number>;
  dueNow: number;
  domainMastery: Array<{
    domain: string;
    itemCount: number;
    averageGrade: number | null;
    attemptCount: number;
  }>;
  criticalFailures: number;
  recurringErrors: Array<{
    domain: string;
    errorCode: string;
    severity: string;
    occurrenceCount: number;
    lastSeenAt: string;
  }>;
  citationFidelityAverage: number | null;
  unsupportedClaimRateAverage: number | null;
  safetyRecallAverage: number | null;
  sourceInvalidations: number;
  promotionQueue: Array<{ id: string; slug: string; domain: string; safetyCritical: boolean }>;
  benchmarkTrend: Array<{
    id: string;
    kind: string;
    label: string;
    startedAt: string;
    completedAt: string | null;
    frozen: boolean;
    metrics: unknown;
  }>;
};

export async function getLearningDashboardMetrics(): Promise<LearningDashboardMetrics> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [statusGroups, dueNow, attempts, openErrors, invalidations, promotionQueue, benchmarkRuns] =
    await Promise.all([
      prisma.collisionLearningItem.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.collisionLearningItem.count({
        where: { status: { in: ["VERIFIED", "PROMOTED"] }, holdout: false, dueAt: { lte: now } },
      }),
      prisma.collisionLearningAttempt.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        select: {
          grade: true,
          citationFidelity: true,
          unsupportedClaimRate: true,
          safetyRecall: true,
          errorCodes: true,
          item: { select: { domain: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 2000,
      }),
      prisma.collisionLearningError.findMany({ where: { resolvedAt: null }, take: 500 }),
      prisma.collisionLearningError.count({ where: { errorCode: "SOURCE_VERSION_INVALIDATED" } }),
      prisma.collisionLearningItem.findMany({
        where: { status: "VERIFIED", holdout: false },
        select: { id: true, slug: true, domain: true, safetyCritical: true },
        orderBy: { updatedAt: "desc" },
        take: 25,
      }),
      prisma.collisionBenchmarkRun.findMany({ orderBy: { startedAt: "desc" }, take: 12 }),
    ]);

  const itemCounts: Record<string, number> = {};
  for (const group of statusGroups) {
    itemCounts[group.status] = group._count._all;
  }

  const byDomain = new Map<string, { grades: number[]; count: number }>();
  let citationSum = 0;
  let unsupportedSum = 0;
  let safetySum = 0;
  let criticalFailures = 0;
  for (const attempt of attempts) {
    const domain = attempt.item.domain;
    const bucket = byDomain.get(domain) ?? { grades: [], count: 0 };
    bucket.grades.push(attempt.grade);
    bucket.count += 1;
    byDomain.set(domain, bucket);
    citationSum += attempt.citationFidelity;
    unsupportedSum += attempt.unsupportedClaimRate;
    safetySum += attempt.safetyRecall;
    if (attempt.errorCodes.includes("SAFETY_CRITICAL_MISS") || attempt.grade === 0) criticalFailures += 1;
  }

  const domainMastery = [...byDomain.entries()]
    .map(([domain, bucket]) => ({
      domain,
      itemCount: bucket.count,
      averageGrade: bucket.grades.length
        ? Math.round((bucket.grades.reduce((a, b) => a + b, 0) / bucket.grades.length) * 100) / 100
        : null,
      attemptCount: bucket.count,
    }))
    .sort((a, b) => (a.averageGrade ?? 6) - (b.averageGrade ?? 6));

  return {
    generatedAt: now.toISOString(),
    itemCounts,
    dueNow,
    domainMastery,
    criticalFailures,
    recurringErrors: rankErrorTargets(openErrors)
      .slice(0, 20)
      .map((error) => ({
        domain: error.domain,
        errorCode: error.errorCode,
        severity: error.severity,
        occurrenceCount: error.occurrenceCount,
        lastSeenAt: error.lastSeenAt.toISOString(),
      })),
    citationFidelityAverage: attempts.length ? citationSum / attempts.length : null,
    unsupportedClaimRateAverage: attempts.length ? unsupportedSum / attempts.length : null,
    safetyRecallAverage: attempts.length ? safetySum / attempts.length : null,
    sourceInvalidations: invalidations,
    promotionQueue,
    benchmarkTrend: benchmarkRuns.map((run) => ({
      id: run.id,
      kind: run.kind,
      label: run.label,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      frozen: run.frozen,
      metrics: run.metrics,
    })),
  };
}
