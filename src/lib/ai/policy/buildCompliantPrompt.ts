import { SAFE_ANALYSIS_RULES } from "@/lib/ai/policy/agentRules";

export function buildCompliantPrompt(task: string, context?: string) {
  return `
${SAFE_ANALYSIS_RULES}

Task:
${task}

Context:
${context ?? "No extra context provided."}

Output requirements:
- Use your own words.
- Do not quote private documents verbatim.
- Do not return raw extracted text.
- Public/open-source website information may be shared.
- Export-safe summary language is allowed.
`.trim();
}
