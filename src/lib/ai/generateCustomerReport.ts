import {
  CUSTOMER_REPORT_NON_BIAS_DIRECTIVE,
  NON_BIAS_ACCURACY_DIRECTIVE,
} from "@/lib/ai/nonBiasDirective";
import { AUTHORITY_RETRIEVAL_POSTURE_DIRECTIVE } from "@/lib/ai/authorityRetrievalPosture";
import { stripEstimateComparisonLanguage } from "@/lib/ai/estimatePosture";

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
  /**
   * False when the file contains only ONE estimate. The report must then avoid
   * every carrier/insurer-comparison framing.
   */
  comparisonAvailable?: boolean;
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

${AUTHORITY_RETRIEVAL_POSTURE_DIRECTIVE}

Report structure:
The rendered report is organized in this exact customer-facing order — write each field for its section:
1. Plain-English Summary (openingSummary)
2. What This Means for You (whichRepairPlanLooksStronger + bottomLine)
3. Key Findings (whatStillNeedsProof)
4. Why These Items Matter (safetyFirst)
5. Questions to Ask (yourOptions)
6. Supporting Documentation
7. Technical Appendix

Estimate comparison context:
${input.comparisonAvailable === false
  ? "Only ONE estimate is in the reviewed file. NEVER mention an insurer/carrier estimate, never compare estimates, never say any estimate 'may be missing items' relative to another, and never imply a shop-vs-carrier disagreement. Frame every open item as a documentation or proof need for THE estimate that was reviewed."
  : "The file contains an estimate comparison; comparison framing is allowed where the documents support it."}

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
- Translate technical labels into plain owner language without assuming repair stage. For example, say "Hidden mounting or structural damage is not verified from the reviewed file" instead of "Hidden Mounting Geometry Teardown Growth".
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
- NEVER state or imply that the policy includes an appraisal option unless policySignals.hasAppraisalClause is true (meaning actual policy language was uploaded and reviewed). When it is NOT true and appraisal is worth mentioning, use exactly this sentence and nothing stronger: "If your policy includes an appraisal or dispute-resolution provision, ask the insurer to identify the exact policy language and explain how it applies to the repair-amount dispute."
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

Bottom line style (model the tone and framing of this example, adapted to the actual vehicle and findings — documents-reviewed based, completeness-of-proof framing, never alarmist):
"Based on the documents reviewed, your vehicle appears repairable, and the estimate includes several important repair-planning items such as pre- and post-repair scans, structural measuring, corrosion protection, and test fitting. That is a positive sign. The main issue is not that the estimate is clearly wrong. The issue is that several important items still need supporting proof, including the manufacturer repair procedure, scan reports, measurement results, and confirmation of any required post-collision inspections. This matters because a complete repair file should show not only what is written on the estimate, but also the procedure, inspection, and completion records that confirm the work is being performed correctly."

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

  return enforceCustomerReportGuards(normalizeCustomerReport(parsed), input);
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

/** Approved conditional wording when policy language was NOT uploaded/reviewed. */
export const APPRAISAL_CONDITIONAL_SENTENCE =
  "If your policy includes an appraisal or dispute-resolution provision, ask the insurer to identify the exact policy language and explain how it applies to the repair-amount dispute.";

const APPRAISAL_ASSERTION_PATTERN =
  /\b(?:your|the)\s+policy\s+(?:includes|provides|has|contains|gives you|offers|allows(?:\s+you)?(?:\s+to\s+use)?)\b[^.?!]*\bapprais/i;

/**
 * Deterministic output guards (prompt rules alone are not enough):
 * - Never assert the policy includes an appraisal option unless actual policy
 *   language was reviewed (policySignals.hasAppraisalClause). Offending
 *   sentences are replaced with the approved conditional wording.
 * - When only one estimate is in the file, strip any carrier/insurer estimate
 *   comparison framing the model produced anyway.
 */
export function enforceCustomerReportGuards(
  report: CustomerReport,
  input: Pick<GenerateCustomerReportInput, "policySignals" | "comparisonAvailable">
): CustomerReport {
  let result = report;

  if (!input.policySignals?.hasAppraisalClause) {
    const replaceSentence = (text: string) =>
      text.replace(
        new RegExp(`[^.?!]*${APPRAISAL_ASSERTION_PATTERN.source}[^.?!]*[.?!]?`, "gi"),
        ` ${APPRAISAL_CONDITIONAL_SENTENCE}`
      ).replace(/\s{2,}/g, " ").trim();
    let conditionalUsed = false;
    const guardOption = (option: string) => {
      if (!APPRAISAL_ASSERTION_PATTERN.test(option)) return option;
      if (conditionalUsed) return null;
      conditionalUsed = true;
      return APPRAISAL_CONDITIONAL_SENTENCE;
    };
    result = {
      ...result,
      openingSummary: replaceSentence(result.openingSummary),
      whichRepairPlanLooksStronger: replaceSentence(result.whichRepairPlanLooksStronger),
      safetyFirst: replaceSentence(result.safetyFirst),
      bottomLine: replaceSentence(result.bottomLine),
      whatStillNeedsProof: result.whatStillNeedsProof
        .map(guardOption)
        .filter((item): item is string => Boolean(item)),
      yourOptions: result.yourOptions
        .map(guardOption)
        .filter((item): item is string => Boolean(item)),
    };
  }

  if (input.comparisonAvailable === false) {
    result = {
      ...result,
      openingSummary: stripEstimateComparisonLanguage(result.openingSummary),
      whichRepairPlanLooksStronger: stripEstimateComparisonLanguage(result.whichRepairPlanLooksStronger),
      safetyFirst: stripEstimateComparisonLanguage(result.safetyFirst),
      bottomLine: stripEstimateComparisonLanguage(result.bottomLine),
      whatStillNeedsProof: result.whatStillNeedsProof.map(stripEstimateComparisonLanguage),
      yourOptions: result.yourOptions.map(stripEstimateComparisonLanguage),
    };
  }

  return result;
}
