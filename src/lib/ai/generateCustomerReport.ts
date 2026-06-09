import {
  CUSTOMER_REPORT_NON_BIAS_DIRECTIVE,
  NON_BIAS_ACCURACY_DIRECTIVE,
} from "@/lib/ai/nonBiasDirective";

export type CustomerReport = {
  title: string;
  openingSummary: string;
  whichRepairPlanLooksStronger: string;
  safetyFirst: string;
  whatStillNeedsProof: string[];
  yourOptions: string[];
  bottomLine: string;
};

export type GenerateCustomerReportInput = {
  vehicle: string;
  insurer?: string | null;
  estimateTotal?: string | null;
  determination: string;
  documentedPositives: string[];
  supportGaps: string[];
  estimateSummary: string;
  imageSummary?: string | null;
  policyholderOptionsContext?: string | null;
  reportMode?: "informational" | "action_guided";
  policySignals?: {
    hasAppraisalClause?: boolean;
    appraisalAppliesToAmountDisputes?: boolean;
    appraisalDoesNotApplyToCoverage?: boolean;
    hasShopChoice?: boolean;
    hasSupplementProcess?: boolean;
    hasPAConsumerRights?: boolean;
    estimateGapDetected?: boolean;
  };
};

function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No valid JSON object found in model response.");
  }

  return text.slice(start, end + 1);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

export async function generateCustomerReport(
  input: GenerateCustomerReportInput,
  deps: {
    generateText: (prompt: string) => Promise<string>;
  }
): Promise<CustomerReport> {
  const prompt = `
You are writing a CUSTOMER REPORT for a vehicle owner.

Audience:
A normal vehicle owner with no collision repair background.

Tone:
Clear, calm, direct, conversational, reassuring, and specific.
Write like a knowledgeable repair professional speaking directly to the vehicle owner in plain language.
Use short paragraphs, natural transitions, and everyday wording.
Avoid internal report voice.

Goals:
- Explain what happened to the vehicle in owner-friendly language.
- Give a direct answer about which repair plan or estimate looks more complete or accurate, if the file supports that.
- Put safety first.
- Explain what is still missing or still needs proof.
- Explain what the owner can do next in real-world terms.
- End with a clear bottom line.

${NON_BIAS_ACCURACY_DIRECTIVE}

${CUSTOMER_REPORT_NON_BIAS_DIRECTIVE}

Report mode:
${input.reportMode ?? "informational"}

Mode guidance:
- If reportMode is "informational", prioritize explanation, clarity, and reassurance.
- If reportMode is "action_guided", include clearer practical next steps and options while staying plain-English and non-legal.

Important rules:
- Do not sound argumentative or insurer-facing.
- Do not mention internal confidence scores, structured analysis engines, or AI systems.
- Do not include evidence chain IDs, immutable keys, runtime context, parser terms, support basis, support confidence, inferred support, verified percentages, citation metadata, source conflicts, or debug identifiers.
- Do not use internal terms like "underwritten operation", "risk if omitted", or "documented evidence at 86%".
- Translate technical labels into plain owner language. For example, say "Possible hidden mounting or structural damage may still need inspection after teardown" instead of "Hidden Mounting Geometry Teardown Growth".
- Do not use labels like DOCUMENTED, SUPPORTABLE_BUT_UNCONFIRMED, OPEN, or REFERENCED_NOT_PRODUCED.
- Do not sound like a claim note, appraiser memo, or internal technical export.
- Do not tell the customer to "ask for" things as a list of demands.
- Instead, explain their practical options and what each option means.
- Keep language simple, direct, and human.
- In "yourOptions", explain the vehicle owner's practical options in layman's terms, including policy-related options if the file supports them.
- If policySignals.hasAppraisalClause is true, explain appraisal clearly in plain English: when it applies to amount or scope disputes, how it works with appraisers and an umpire, and what outcome it produces.
- If policySignals.hasShopChoice is true, explain that the owner can stay with their chosen repair facility.
- If policySignals.hasSupplementProcess is true, explain that additional repair findings can be documented and submitted.
- If policySignals.hasPAConsumerRights is true, explain that the owner can request written status updates and written explanation of delays or decisions.
- If policy language or policy-related forms indicate an appraisal option, you may include a plain-English option explaining that appraisal can be used to resolve a disagreement about the amount of loss.
- If Pennsylvania claims-handling timing or assistance rules are supported in the provided policy/law context, you may include a plain-English option that the owner can request a written status update, written explanation for delay, or written explanation of position.
- If the file supports shop-choice rights, you may include a plain-English option explaining that the owner does not have to move the vehicle to a different shop just because the insurer's estimate is lower.
- If the file supports supplement handling based on additional repair findings, you may explain in plain language that the repair shop can document added findings and submit them for review.
- Do not present legal advice or say the customer definitely has a right unless the file clearly supports it.
- Use soft, accurate framing such as "your policy may allow", "the file supports", or "you may be able to".
- Do not say "may" if the policy clearly supports the option.
- Do not mention statutes or code sections in a lawyerly way inside the body unless they are translated into plain language.
- When OEM or procedure documents are referenced but not retrieved, treat them as directional support for the repair path.
- Do not say those documents were fully reviewed.
- You may explain that referenced procedure material tends to support operations like calibration, scan, alignment, fit-check, or structural verification when that is consistent with the damage path.
- Do not use legal language. Translate everything into everyday speech.
- Do not include clipped placeholders or partial policy fragments in the final prose.
- If a CCC workfile is mentioned, say only: "CCC Secure Share source confirms this estimate line was present in the structured estimate data."

Ranking rules for "yourOptions":
- Return the options in priority order, strongest and most meaningful first.
- If policySignals.hasAppraisalClause is true, policySignals.appraisalAppliesToAmountDisputes is true, and policySignals.estimateGapDetected is true, then the appraisal option should appear before any option about requesting a written explanation, written update, or emailing the insurer about differences.
- Keep appraisal language cautious and policy-safe. Use wording like "If your policy allows it, you may be able to use the appraisal process..." but explain immediately why it matters here: it is more relevant when the disagreement is mainly about repair amount or scope, not whether the loss is covered.
- If policySignals.hasShopChoice is true, the shop-choice option should usually appear near the top as well.
- Written-status and written-explanation options should still be included when supported, but they should rank below appraisal in a true estimate-gap dispute.

- This is the one export that may break away from the structure of the others and feel more human.
- Be specific to the vehicle and repair situation.
- Distinguish what is clearly shown, what is likely, and what still needs confirmation.
- If the file supports one estimate or repair path more strongly, say so plainly and explain why.
- Safety, fit, function, and proper verification matter more than keeping the estimate artificially low.
- Return JSON only.

Return exactly this shape:
{
  "title": "string",
  "openingSummary": "string",
  "whichRepairPlanLooksStronger": "string",
  "safetyFirst": "string",
  "whatStillNeedsProof": ["string"],
  "yourOptions": ["string"],
  "bottomLine": "string"
}

Vehicle:
${input.vehicle}

Insurer:
${input.insurer ?? "Unknown"}

Estimate Total:
${input.estimateTotal ?? "Unknown"}

Repair Determination:
${input.determination}

Documented Positives:
${input.documentedPositives.length > 0 ? input.documentedPositives.map((item) => `- ${item}`).join("\n") : "- None listed"}

Support Gaps:
${input.supportGaps.length > 0 ? input.supportGaps.map((item) => `- ${item}`).join("\n") : "- None listed"}

Estimate Summary:
${input.estimateSummary}

Image Summary:
${input.imageSummary ?? "No image summary provided."}

Policyholder Options Context:
${input.policyholderOptionsContext ?? "No policyholder-specific policy or law context was provided."}

Policy Signals:
${JSON.stringify(input.policySignals ?? {}, null, 2)}
`.trim();

  const raw = await deps.generateText(prompt);
  const parsed = JSON.parse(extractJsonObject(raw)) as Partial<CustomerReport>;

  return normalizeCustomerReport(parsed);
}

function normalizeCustomerReport(parsed: Partial<CustomerReport>): CustomerReport {
  return {
    title:
      typeof parsed.title === "string" && parsed.title.trim()
        ? parsed.title.trim()
        : "Customer Report",
    openingSummary:
      typeof parsed.openingSummary === "string" ? parsed.openingSummary.trim() : "",
    whichRepairPlanLooksStronger:
      typeof parsed.whichRepairPlanLooksStronger === "string"
        ? parsed.whichRepairPlanLooksStronger.trim()
        : "",
    safetyFirst:
      typeof parsed.safetyFirst === "string" ? parsed.safetyFirst.trim() : "",
    whatStillNeedsProof: asStringArray(parsed.whatStillNeedsProof),
    yourOptions: asStringArray(parsed.yourOptions),
    bottomLine: typeof parsed.bottomLine === "string" ? parsed.bottomLine.trim() : "",
  };
}
