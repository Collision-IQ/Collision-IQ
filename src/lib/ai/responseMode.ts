export type ResponseMode = "concise" | "standard" | "analysis";

type ResponseModeContext = {
  userMessage: string;
  hasUploadedFiles: boolean;
  isFollowup: boolean;
};

export const RESPONSE_MODE_INSTRUCTIONS: Record<ResponseMode, string> = {
  concise:
    "Default to concise answers. Answer the user's question first. Use brief evidence-grounded structure and avoid recap, padding, or repeating prior context.",
  standard:
    "Answer directly, then provide brief reasoning. Keep the response short and practical unless the user requests deeper detail.",
  analysis:
    "Provide a full professional analysis with findings, evidence, confidence, recommendations, and next steps only when explicitly requested.",
};

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
