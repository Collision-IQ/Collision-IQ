export type ResponseMode = "concise" | "standard" | "analysis";

type ResponseModeContext = {
  userMessage: string;
  hasUploadedFiles: boolean;
  isFollowup: boolean;
};

export const RESPONSE_MODE_INSTRUCTIONS: Record<ResponseMode, string> = {
  concise:
    "Answer in 1-4 sentences. Answer the user's question first. Do not provide extended analysis unless required. Avoid recap, padding, or repeating prior context.",
  standard:
    "Answer directly, then provide brief reasoning. Keep the response under about 200 words when possible.",
  analysis:
    "Provide a full professional analysis with findings, evidence, confidence, recommendations, and next steps.",
};

export function determineResponseMode(context: ResponseModeContext): ResponseMode {
  const text = context.userMessage.toLowerCase();

  const explicitlyDetailed =
    /\b(detail|detailed|explain|full analysis|report|breakdown|why|confidence|estimate|insurance|legal|liability|damage analysis)\b/.test(
      text
    );
  const quickQuestion =
    /^(can|is|are|do|does|did|will|should|would|could)\b/.test(text.trim()) ||
    text.trim().length < 120;
  const recommendation =
    /\b(recommend|compare|best|should i|which|workflow|process|repair)\b/.test(text);

  if (context.hasUploadedFiles) return "analysis";
  if (explicitlyDetailed) return "analysis";
  if (context.isFollowup) return "concise";
  if (recommendation) return "standard";
  if (quickQuestion) return "concise";

  return "concise";
}

export function buildResponseModeInstruction(mode: ResponseMode): string {
  return `RESPONSE DEPTH: ${mode.toUpperCase()}\n${RESPONSE_MODE_INSTRUCTIONS[mode]}`;
}
