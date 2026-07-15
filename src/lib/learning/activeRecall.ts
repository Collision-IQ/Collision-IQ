import "server-only";
import { generatePrimaryText } from "@/lib/ai/providerTextGeneration";

/**
 * Collision Learning Engine — active-recall runner.
 *
 * HARD ISOLATION RULE: the response-generating model must never receive the
 * reference answer, grader output, holdout answers, or evaluator notes.
 * This module's input type simply does not carry them, and the prompt builder
 * only consumes whitelisted fields.
 */

export type ActiveRecallInput = {
  itemId: string;
  domain: string;
  objective: string;
  prompt: string;
  mode: "ACTIVE_RECALL" | "FEYNMAN" | "CONTRAST" | "INTERLEAVED_CASE" | "FULL_REPORT" | "HOLDOUT";
  oem?: string | null;
  jurisdiction?: string | null;
  /** Vehicle scope constraint (e.g. the MOTOR sandbox vehicle) — included as a CONSTRAINT, never as an answer. */
  vehicleScope?: unknown;
};

export type ActiveRecallResponse = {
  modelName: string;
  provider: string;
  output: { text: string };
};

// The static instruction block is stable across items so an Anthropic-backed
// runner benefits from prompt caching (cached text is NOT model memory).
const RECALL_SYSTEM_INSTRUCTIONS = [
  "You are Collision IQ operating in closed-book active-recall evaluation mode.",
  "Answer from collision-repair domain knowledge. You have NOT been given the reference answer, and none will be provided.",
  "Rules:",
  "- Distinguish clearly between: not present, potentially required, required by the available evidence, included elsewhere, and not enough information to determine.",
  "- Never generalize a structural or safety recommendation across manufacturers without stating that the applicable vehicle-specific procedure must be confirmed.",
  "- MOTOR/CCC data access is vehicle-scoped; never represent scoped data as comprehensive coverage, and state plainly when a vehicle is unsupported.",
  "- State what evidence would prove your answer wrong and what information is still missing.",
  "- If you cannot support a conclusion, say so instead of guessing.",
].join("\n");

function buildRecallPrompt(input: ActiveRecallInput): string {
  const scope: string[] = [];
  if (input.oem) scope.push(`OEM scope: ${input.oem}.`);
  if (input.jurisdiction) scope.push(`Jurisdiction scope: ${input.jurisdiction}.`);
  if (input.vehicleScope) scope.push(`Vehicle scope constraint: ${JSON.stringify(input.vehicleScope)}.`);
  return [
    `Domain: ${input.domain}`,
    `Learning objective: ${input.objective}`,
    ...scope,
    "",
    input.prompt,
  ].join("\n");
}

const FEYNMAN_SUFFIX = [
  "",
  "Explain your answer at three levels, using these exact section headings:",
  "## Vehicle owner",
  "Plain English, outcome first, no unnecessary technical detail.",
  "## Estimator or technician",
  "Technical steps, evidence, and estimating implications.",
  "## Expert reviewer",
  "Scope, source hierarchy, exceptions, uncertainty, and the strongest opposing interpretation.",
  "",
  "Then answer: (a) What fact would prove this explanation wrong? (b) What information is still missing? (c) Does the answer change by OEM, model, year, material, jurisdiction, or repair method?",
].join("\n");

/**
 * Run one learning item against the production provider abstraction. The
 * function signature deliberately has no way to pass a gold answer.
 */
export async function answerLearningItem(input: ActiveRecallInput): Promise<ActiveRecallResponse> {
  const prompt =
    input.mode === "FEYNMAN" ? `${buildRecallPrompt(input)}\n${FEYNMAN_SUFFIX}` : buildRecallPrompt(input);

  const result = await generatePrimaryText({
    stage: `learning-${input.mode.toLowerCase().replace(/_/g, "-")}`,
    instructions: RECALL_SYSTEM_INSTRUCTIONS,
    input: prompt,
    maxTokens: 2000,
  });

  return {
    modelName: result.model,
    provider: result.provider,
    output: { text: result.output_text },
  };
}
