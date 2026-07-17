export type ResponseMode = "concise" | "standard" | "analysis";

type ResponseModeContext = {
  userMessage: string;
  hasUploadedFiles: boolean;
  isFollowup: boolean;
};

export const RESPONSE_MODE_INSTRUCTIONS: Record<ResponseMode, string> = {
  concise:
    "Answer in 2-5 sentences or at most 4 short bullets. Lead with the direct answer. NO headers, NO section scaffolding, NO case recap, NO restating prior context. Skip 'Why / What Remains Open / What Changed' style sections entirely unless one open item is genuinely material — then mention it in one sentence. Match the length of the answer to the size of the question.",
  standard:
    "Answer directly, then provide brief reasoning in a few sentences or tight bullets. No section headers unless the content genuinely needs them. Keep the response short and practical unless the user requests deeper detail.",
  analysis:
    "Provide a full professional analysis with findings, evidence, confidence, recommendations, and next steps only when explicitly requested.",
};

/**
 * Provider generation parameters matched to the response depth. Simple
 * follow-ups do not need extended high-effort reasoning or a 32k output
 * budget — capping both is what makes short questions answer fast.
 */
export function resolveResponseModeGeneration(mode: ResponseMode): {
  effort: "low" | "medium" | "high";
  maxTokens: number;
} {
  // NOTE: adaptive thinking tokens count against max_tokens — budgets leave
  // headroom so a short answer is never truncated mid-sentence.
  if (mode === "concise") return { effort: "low", maxTokens: 1600 };
  if (mode === "standard") return { effort: "medium", maxTokens: 3000 };
  return { effort: "high", maxTokens: 8000 };
}

export function determineResponseMode(context: ResponseModeContext): ResponseMode {
  const text = context.userMessage.toLowerCase();

  const explicitlyDetailed =
    /\b(full analysis|full review|formal rebuttal|rebuttal letter|doi complaint|department of insurance complaint|report|demand letter|appeal letter|in detail|comprehensive)\b/.test(
      text
    );
  const quickQuestion =
    /^(can|is|are|do|does|did|will|should|would|could)\b/.test(text.trim()) ||
    text.trim().length < 120;
  const recommendation =
    /\b(recommend|compare|best|should i|which|workflow|process|repair)\b/.test(text);

  if (explicitlyDetailed) return "analysis";
  if (context.isFollowup) return "concise";
  if (recommendation) return "standard";
  if (context.hasUploadedFiles) return "concise";
  if (quickQuestion) return "concise";

  return "concise";
}

export function buildResponseModeInstruction(mode: ResponseMode): string {
  return `RESPONSE DEPTH: ${mode.toUpperCase()}\n${RESPONSE_MODE_INSTRUCTIONS[mode]}`;
}
