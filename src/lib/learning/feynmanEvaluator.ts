import "server-only";
import { prisma } from "@/lib/prisma";
import { answerLearningItem } from "./activeRecall";
import { evaluateLearningAnswer, type GoldAnswer, type LearningEvaluation } from "./answerEvaluator";
import type { LearningSourceRef } from "./sourceAuthority";

/**
 * Collision Learning Engine — Feynman explanation testing.
 *
 * A failed active-recall attempt triggers a three-level explanation
 * remediation pass: vehicle owner, estimator/technician, expert reviewer —
 * plus falsifiability, missing-information, and scope-variation answers.
 */

export { checkFeynmanStructure } from "./feynmanStructure";
export type { FeynmanStructureCheck } from "./feynmanStructure";
import { checkFeynmanStructure } from "./feynmanStructure";

export async function createFeynmanRemediation(params: {
  item: {
    id: string;
    domain: string;
    objective: string;
    prompt: string;
    oem?: string | null;
    jurisdiction?: string | null;
    vehicleScope?: unknown;
    safetyCritical: boolean;
    goldAnswer: unknown;
    sourceRefs: unknown;
  };
  failedResponse: { text: string };
  evaluation: LearningEvaluation;
}): Promise<{ attemptId: string; grade: number }> {
  const { item } = params;

  // The remediation prompt tells the model only THAT the prior answer was
  // incomplete — never the gold answer or the evaluator's rubric output.
  const response = await answerLearningItem({
    itemId: item.id,
    domain: item.domain,
    objective: item.objective,
    prompt: `${item.prompt}\n\nYour previous answer to this question was incomplete or unsupported. Answer again with more care.`,
    mode: "FEYNMAN",
    oem: item.oem,
    jurisdiction: item.jurisdiction,
    vehicleScope: item.vehicleScope,
  });

  const structure = checkFeynmanStructure(response.output.text);
  const evaluation = evaluateLearningAnswer({
    candidateText: response.output.text,
    goldAnswer: item.goldAnswer as GoldAnswer,
    sourceRefs: (item.sourceRefs as LearningSourceRef[]) ?? [],
    safetyCritical: item.safetyCritical,
    vehicleScope: item.vehicleScope,
  });
  // An explanation missing an audience level is at best materially incomplete.
  const grade = structure.complete ? evaluation.grade : Math.min(evaluation.grade, 2);
  const errorCodes = structure.complete
    ? evaluation.errorCodes
    : [...new Set([...evaluation.errorCodes, "FEYNMAN_LEVEL_MISSING"])];

  const attempt = await prisma.collisionLearningAttempt.create({
    data: {
      itemId: item.id,
      mode: "FEYNMAN",
      modelName: response.modelName,
      response: { text: response.output.text, structure },
      grade,
      factualAccuracy: evaluation.factualAccuracy,
      evidenceCoverage: evaluation.evidenceCoverage,
      citationFidelity: evaluation.citationFidelity,
      safetyRecall: evaluation.safetyRecall,
      calibrationScore: evaluation.calibrationScore,
      unsupportedClaimRate: evaluation.unsupportedClaimRate,
      evaluatorVersion: evaluation.evaluatorVersion,
      errorCodes,
    },
  });

  return { attemptId: attempt.id, grade };
}
