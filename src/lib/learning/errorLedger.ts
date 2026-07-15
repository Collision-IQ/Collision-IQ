import "server-only";
import { prisma } from "@/lib/prisma";
import type { LearningEvaluation } from "./answerEvaluator";

/**
 * Collision Learning Engine — error ledger.
 *
 * Aggregates recurring failure patterns per (domain, errorCode) so Saturday
 * error-led remediation drills concentrate on the actual weaknesses.
 */

export { rankErrorTargets, severityForErrorCode } from "./errorRanking";
import { rankErrorTargets, severityForErrorCode } from "./errorRanking";

export async function recordLearningErrors(
  item: { id: string; domain: string },
  evaluation: LearningEvaluation
): Promise<void> {
  for (const errorCode of evaluation.errorCodes) {
    const severity = severityForErrorCode(errorCode);
    const existing = await prisma.collisionLearningError.findFirst({
      where: { domain: item.domain, errorCode, resolvedAt: null },
      orderBy: { lastSeenAt: "desc" },
    });
    if (existing) {
      await prisma.collisionLearningError.update({
        where: { id: existing.id },
        data: {
          occurrenceCount: { increment: 1 },
          lastSeenAt: new Date(),
          itemId: item.id,
        },
      });
    } else {
      await prisma.collisionLearningError.create({
        data: {
          itemId: item.id,
          domain: item.domain,
          errorCode,
          severity,
          description: evaluation.notes.slice(0, 3).join(" | ") || errorCode,
        },
      });
    }
  }
}

export async function selectRemediationTargets(limit = 10) {
  const open = await prisma.collisionLearningError.findMany({
    where: { resolvedAt: null },
    orderBy: { lastSeenAt: "desc" },
    take: 200,
  });
  return rankErrorTargets(open).slice(0, limit);
}
