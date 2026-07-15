import "server-only";
import { prisma } from "@/lib/prisma";
import { answerLearningItem } from "./activeRecall";
import { evaluateLearningAnswer, type GoldAnswer } from "./answerEvaluator";
import type { LearningSourceRef } from "./sourceAuthority";

/**
 * Collision Learning Engine — weekly holdout benchmark.
 *
 * Holdout items are benchmark-only: they never appear in daily sprints, and
 * their gold answers are only ever seen by the evaluator AFTER the candidate
 * response is complete. Frozen runs (baseline/capstone) are immutable
 * comparison points.
 */

export type BenchmarkMetrics = {
  itemCount: number;
  averageGrade: number;
  safetyRecallAverage: number;
  citationFidelityAverage: number;
  unsupportedClaimRateAverage: number;
  gradeCounts: Record<string, number>;
};

export function summarizeBenchmarkGrades(
  results: Array<{ grade: number; safetyRecall: number; citationFidelity: number; unsupportedClaimRate: number }>
): BenchmarkMetrics {
  const itemCount = results.length;
  const sum = (selector: (r: (typeof results)[number]) => number) =>
    results.reduce((total, result) => total + selector(result), 0);
  const gradeCounts: Record<string, number> = {};
  for (const result of results) {
    gradeCounts[String(result.grade)] = (gradeCounts[String(result.grade)] ?? 0) + 1;
  }
  return {
    itemCount,
    averageGrade: itemCount ? sum((r) => r.grade) / itemCount : 0,
    safetyRecallAverage: itemCount ? sum((r) => r.safetyRecall) / itemCount : 0,
    citationFidelityAverage: itemCount ? sum((r) => r.citationFidelity) / itemCount : 0,
    unsupportedClaimRateAverage: itemCount ? sum((r) => r.unsupportedClaimRate) / itemCount : 0,
    gradeCounts,
  };
}

/** An item regressed when its grade dropped below the previous run's grade. */
export function detectRegressions(
  current: Array<{ itemId: string; grade: number }>,
  previous: Array<{ itemId: string; grade: number }>
): Set<string> {
  const previousById = new Map(previous.map((result) => [result.itemId, result.grade]));
  const regressed = new Set<string>();
  for (const result of current) {
    const before = previousById.get(result.itemId);
    if (typeof before === "number" && result.grade < before) regressed.add(result.itemId);
  }
  return regressed;
}

export async function runHoldoutBenchmark(params: {
  kind: "BASELINE" | "WEEKLY" | "HOLDOUT" | "CAPSTONE";
  label: string;
  limit?: number;
  notes?: string;
}): Promise<{ runId: string; metrics: BenchmarkMetrics; regressions: number }> {
  const items = await prisma.collisionLearningItem.findMany({
    where: { holdout: true, status: { in: ["VERIFIED", "PROMOTED"] } },
    orderBy: [{ safetyCritical: "desc" }, { createdAt: "asc" }],
    take: params.limit ?? 100,
  });

  const run = await prisma.collisionBenchmarkRun.create({
    data: { kind: params.kind, label: params.label, notes: params.notes },
  });

  // Previous comparable run for regression detection.
  const previousRun = await prisma.collisionBenchmarkRun.findFirst({
    where: { kind: params.kind, completedAt: { not: null }, id: { not: run.id } },
    orderBy: { startedAt: "desc" },
    include: { results: { select: { itemId: true, grade: true } } },
  });

  const evaluated: Array<{
    itemId: string;
    grade: number;
    safetyRecall: number;
    citationFidelity: number;
    unsupportedClaimRate: number;
    metrics: object;
  }> = [];

  for (const item of items) {
    // The generating model receives the prompt only — never the holdout answer.
    const response = await answerLearningItem({
      itemId: item.id,
      domain: item.domain,
      objective: item.objective,
      prompt: item.prompt,
      mode: "HOLDOUT",
      oem: item.oem,
      jurisdiction: item.jurisdiction,
      vehicleScope: item.vehicleScope ?? undefined,
    });
    const evaluation = evaluateLearningAnswer({
      candidateText: response.output.text,
      goldAnswer: item.goldAnswer as GoldAnswer,
      sourceRefs: (item.sourceRefs as LearningSourceRef[]) ?? [],
      safetyCritical: item.safetyCritical,
      vehicleScope: item.vehicleScope,
      jurisdiction: item.jurisdiction,
    });

    await prisma.collisionLearningAttempt.create({
      data: {
        itemId: item.id,
        mode: "HOLDOUT",
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
        benchmarkRunId: run.id,
      },
    });

    evaluated.push({
      itemId: item.id,
      grade: evaluation.grade,
      safetyRecall: evaluation.safetyRecall,
      citationFidelity: evaluation.citationFidelity,
      unsupportedClaimRate: evaluation.unsupportedClaimRate,
      metrics: {
        factualAccuracy: evaluation.factualAccuracy,
        evidenceCoverage: evaluation.evidenceCoverage,
        citationFidelity: evaluation.citationFidelity,
        safetyRecall: evaluation.safetyRecall,
        calibrationScore: evaluation.calibrationScore,
        unsupportedClaimRate: evaluation.unsupportedClaimRate,
        errorCodes: evaluation.errorCodes,
      },
    });
  }

  const regressions = detectRegressions(
    evaluated,
    previousRun?.results ?? []
  );

  for (const result of evaluated) {
    await prisma.collisionBenchmarkResult.create({
      data: {
        runId: run.id,
        itemId: result.itemId,
        mode: "HOLDOUT",
        grade: result.grade,
        metrics: result.metrics,
        regression: regressions.has(result.itemId),
      },
    });
  }

  const metrics = summarizeBenchmarkGrades(evaluated);
  await prisma.collisionBenchmarkRun.update({
    where: { id: run.id },
    data: { completedAt: new Date(), metrics: metrics as object },
  });

  return { runId: run.id, metrics, regressions: regressions.size };
}

/** Freeze a run (baseline / capstone) so it becomes an immutable comparison point. */
export async function freezeBenchmarkRun(runId: string): Promise<void> {
  await prisma.collisionBenchmarkRun.update({ where: { id: runId }, data: { frozen: true } });
}
