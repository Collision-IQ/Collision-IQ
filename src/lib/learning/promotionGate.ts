import "server-only";
import { prisma } from "@/lib/prisma";
import { evaluatePromotionEligibility } from "./promotionRules";

/**
 * Collision Learning Engine — promotion gate (database application layer).
 *
 * No learning result changes production automatically, and model-generated
 * text can never approve itself: promotion requires a Platform Admin's
 * identity (from the authenticated session, never from model output), and
 * eligibility is computed from recorded attempts/benchmarks only. The pure
 * gate rules live in promotionRules.ts.
 */
export { evaluatePromotionEligibility } from "./promotionRules";
export type { PromotionAttempt, PromotionBenchmark, PromotionCandidate, PromotionEligibility } from "./promotionRules";

export async function promoteLearningItem(params: {
  itemId: string;
  benchmarkRunId: string;
  /** The authenticated Platform Admin's user id/email — from the session, never model output. */
  approvedBy: string;
  notes?: string;
}): Promise<{ promoted: boolean; failedGates: string[] }> {
  const item = await prisma.collisionLearningItem.findUnique({
    where: { id: params.itemId },
    include: { attempts: { orderBy: { createdAt: "asc" } } },
  });
  if (!item) return { promoted: false, failedGates: ["item not found"] };

  const run = await prisma.collisionBenchmarkRun.findUnique({
    where: { id: params.benchmarkRunId },
    include: { results: { select: { regression: true } } },
  });

  const eligibility = evaluatePromotionEligibility({
    item: { status: item.status, safetyCritical: item.safetyCritical, sourceFingerprint: item.sourceFingerprint },
    attempts: item.attempts.map((attempt) => ({
      mode: attempt.mode,
      grade: attempt.grade,
      citationFidelity: attempt.citationFidelity,
      errorCodes: attempt.errorCodes,
      createdAt: attempt.createdAt,
    })),
    benchmark: run
      ? { id: run.id, completedAt: run.completedAt, hasRegression: run.results.some((result) => result.regression) }
      : null,
  });

  if (!eligibility.eligible) {
    return { promoted: false, failedGates: eligibility.failedGates };
  }

  await prisma.$transaction([
    prisma.collisionLearningItem.update({
      where: { id: item.id },
      data: { status: "PROMOTED" },
    }),
    prisma.collisionLearningPromotion.create({
      data: {
        itemId: item.id,
        sourceFingerprint: item.sourceFingerprint,
        benchmarkRunId: params.benchmarkRunId,
        approvedBy: params.approvedBy,
        notes: params.notes,
      },
    }),
  ]);

  return { promoted: true, failedGates: [] };
}
