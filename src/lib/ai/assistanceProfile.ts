export type AssistanceProfile =
  | "shop"
  | "insurance_adjuster"
  | "policyholder"
  | "attorney_or_appraiser"
  | "other";

const PROFILE_GUIDANCE: Record<AssistanceProfile, string> = {
  shop: "Prioritize safety, OEM compliance, repair completeness, documentation, and policy support.",
  insurance_adjuster:
    "Prioritize policy accuracy, estimate accuracy, verified procedure support, and legal/compliance caution.",
  policyholder:
    "Prioritize plain-language explanation, options, safety, repair quality, and practical next steps.",
  attorney_or_appraiser:
    "Prioritize evidence chain, policy language, timing, appraisal posture, and jurisdiction caution.",
  other: "Use a balanced evidence-first review.",
};

export function normalizeAssistanceProfile(value: unknown): AssistanceProfile | null {
  if (typeof value !== "string") return null;
  return value in PROFILE_GUIDANCE ? (value as AssistanceProfile) : null;
}

export function buildAssistanceProfileInstruction(value: unknown): string {
  const profile = normalizeAssistanceProfile(value);
  if (!profile) return "";

  return `ASSISTANCE PROFILE: ${profile}\n${PROFILE_GUIDANCE[profile]}`;
}
