export type AssistanceProfile =
  | "shop"
  | "insurance_adjuster"
  | "policyholder"
  | "attorney_or_appraiser"
  | "other";

// Audience-specific tone + depth. Collision IQ serves a wide range of users
// (worried vehicle owners through appraisers/attorneys), so the same question
// should be answered differently depending on who is asking.
const PROFILE_GUIDANCE: Record<AssistanceProfile, string> = {
  shop:
    "Audience: repair shop / estimator. Be technical and tactical — estimating posture, labor realism, access burden, OEM procedure leverage, and documentation. Prioritize safety, OEM compliance, repair completeness, and policy support.",
  insurance_adjuster:
    "Audience: insurance adjuster. Be neutral and precise — policy, coverage, procedure, and documentation framing. Prioritize policy/estimate accuracy, verified procedure support, and compliance caution.",
  policyholder:
    "Audience: vehicle owner / policyholder. Be plain, calm, and reassuring — avoid jargon (define it if unavoidable); explain what it means for them, their safety, and their practical options and next steps.",
  attorney_or_appraiser:
    "Audience: attorney / appraiser. Be evidence- and citation-focused — separate what is established from what is unproven, the evidence chain, policy language, appraisal posture, and jurisdiction caution.",
  other:
    "Audience not specified — infer it from the question's wording and tone and adapt plainness vs technical depth accordingly.",
};

// Applies to EVERY answer, regardless of whether a profile is chosen. This is
// added to the chat SYSTEM PROMPT only — never to a retrieval/embedding query.
const CONVERSATION_BEHAVIOR_DIRECTIVE = `
CONVERSATION BEHAVIOR (this outranks every other instruction):
- You are a chatbot first. Answer the user's actual question, in their tone, at the depth they need. Not every message is a document review — general questions, quick clarifications, photo questions, greetings, and casual conversation get a natural, direct answer.
- Never say you are "waiting for estimate files", "cannot proceed", or "do not have files" when the user asked something you can simply answer. If a file would genuinely help, briefly offer it as an optional next step — never gate the answer on it.
- Match answer length to the question. Across typical questions the rough mix should be about 60% short (1-3 sentences), 10% a short paragraph, 20% extended (a few short paragraphs or bullets for genuinely multi-part or review questions), and 10% expert depth (only when the user asks for a deep technical or appraisal-grade breakdown). Never pad — a simple question gets a simple answer.
- Read the role and tone of the question (a worried owner, a shop estimator, an adjuster, an appraiser/attorney) and adapt plainness vs technical depth accordingly.
`.trim();

export function normalizeAssistanceProfile(value: unknown): AssistanceProfile | null {
  if (typeof value !== "string") return null;
  return value in PROFILE_GUIDANCE ? (value as AssistanceProfile) : null;
}

/**
 * Short audience-only line. Safe to append to retrieval/embedding queries and
 * compact prompt templates. Empty when no specific profile is chosen so it does
 * not pollute a retrieval query with boilerplate.
 */
export function buildAssistanceProfileInstruction(value: unknown): string {
  const profile = normalizeAssistanceProfile(value);
  if (!profile || profile === "other") return "";
  return `ASSISTANCE PROFILE: ${profile}\n${PROFILE_GUIDANCE[profile]}`;
}

/**
 * Full conversation-behavior directive (chatbot-first + answer-length
 * calibration + audience) for use in the chat SYSTEM PROMPT only. When no
 * profile is set, the model is told to infer the audience from tone.
 */
export function buildConversationBehaviorDirective(value: unknown): string {
  const profile = normalizeAssistanceProfile(value);
  const audienceLine =
    profile && profile !== "other"
      ? `ASSISTANCE PROFILE: ${profile}\n${PROFILE_GUIDANCE[profile]}`
      : "AUDIENCE: not specified — infer the audience (vehicle owner, repair shop, adjuster, or appraiser/attorney) from the question's wording and tone, and default to plain, owner-friendly language when unclear.";
  return `${CONVERSATION_BEHAVIOR_DIRECTIVE}\n\n${audienceLine}`;
}
