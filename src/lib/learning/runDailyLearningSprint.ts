import "server-only";
import { prisma } from "@/lib/prisma";
import { scheduleNextReview } from "./scheduler";
import { interleaveLearningItems } from "./interleaveCases";
import { answerLearningItem } from "./activeRecall";
import { evaluateLearningAnswer, type GoldAnswer } from "./answerEvaluator";
import { createFeynmanRemediation } from "./feynmanEvaluator";
import { recordLearningErrors } from "./errorLedger";
import type { LearningSourceRef } from "./sourceAuthority";

/**
 * Collision Learning Engine — daily sprint runner.
 *
 * Pulls due VERIFIED/PROMOTED items (safety-critical first), interleaves
 * domains, answers each item closed-book, evaluates against the gold answer
 * (evaluator only — the generating model never sees it), reschedules with
 * spaced repetition, records errors, and queues Feynman remediation for
 * failures.
 *
 * HOLDOUT items are structurally excluded — they exist only for benchmarks.
 */

export type DailySprintResult = {
  reviewed: number;
  results: Array<{ itemId: string; grade: number; nextReviewAt: Date }>;
};

export async function runDailyLearningSprint(limit = 100): Promise<DailySprintResult> {
  const dueItems = await prisma.collisionLearningItem.findMany({
    where: {
      status: { in: ["VERIFIED", "PROMOTED"] },
      holdout: false, // private holdout set never enters daily circulation
      dueAt: { lte: new Date() },
    },
    orderBy: [{ safetyCritical: "desc" }, { dueAt: "asc" }],
    take: limit,
  });

  const items = interleaveLearningItems(dueItems);
  const results: DailySprintResult["results"] = [];

  for (const item of items) {
    // Gold answer and source excerpts are intentionally withheld — the input
    // type of answerLearningItem cannot carry them.
    const response = await answerLearningItem({
      itemId: item.id,
      domain: item.domain,
      objective: item.objective,
      prompt: item.prompt,
      mode: "ACTIVE_RECALL",
      oem: item.oem,
      jurisdiction: item.jurisdiction,
      vehicleScope: item.vehicleScope ?? undefined,
    });

    // A separate evaluator receives the approved answer and sources AFTER the
    // candidate response is complete.
    const evaluation = evaluateLearningAnswer({
      candidateText: response.output.text,
      goldAnswer: item.goldAnswer as GoldAnswer,
      sourceRefs: (item.sourceRefs as LearningSourceRef[]) ?? [],
      safetyCritical: item.safetyCritical,
      vehicleScope: item.vehicleScope,
      jurisdiction: item.jurisdiction,
    });

    const next = scheduleNextReview(
      {
        intervalDays: item.intervalDays,
        ease: item.ease,
        repetitions: item.repetitions,
        lapses: item.lapses,
        safetyCritical: item.safetyCritical,
      },
      evaluation.grade
    );

    await prisma.$transaction([
      prisma.collisionLearningAttempt.create({
        data: {
          itemId: item.id,
          mode: "ACTIVE_RECALL",
          modelName: response.modelName,
          response: { text: response.output.text },
          grade: evaluation.grade,
          factualAccuracy: evaluation.factualAccuracy,
          evidenceCoverage: evaluation.evidenceCoverage,
          citationFidelity: evaluation.citationFidelity,
          safetyRecall: evaluation.safetyRecall,
          calibrationScore: evaluation.calibrationScore,
          unsupportedClaimRate: evaluation.unsupportedClaimRate,
          evaluatorVersion: evaluation.evaluatorVersion,
          errorCodes: evaluation.errorCodes,
        },
      }),
      prisma.collisionLearningItem.update({
        where: { id: item.id },
        data: {
          dueAt: next.dueAt,
          intervalDays: next.intervalDays,
          ease: next.ease,
          repetitions: next.repetitions,
          lapses: next.lapses,
        },
      }),
    ]);

    await recordLearningErrors(item, evaluation);

    if (evaluation.grade < 3) {
      await createFeynmanRemediation({
        item: {
          id: item.id,
          domain: item.domain,
          objective: item.objective,
          prompt: item.prompt,
          oem: item.oem,
          jurisdiction: item.jurisdiction,
          vehicleScope: item.vehicleScope ?? undefined,
          safetyCritical: item.safetyCritical,
          goldAnswer: item.goldAnswer,
          sourceRefs: item.sourceRefs,
        },
        failedResponse: { text: response.output.text },
        evaluation,
      });
    }

    results.push({ itemId: item.id, grade: evaluation.grade, nextReviewAt: next.dueAt });
  }

  return { reviewed: results.length, results };
}
