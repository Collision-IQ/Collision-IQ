import "server-only";
import { generateClaudeMessage } from "@/lib/anthropic";
import {
  classifyAnthropicProviderError,
} from "@/lib/anthropic";
import { RETRYABLE_PROVIDER_USER_MESSAGE } from "@/lib/ai/providerRetryableError";
import {
  collisionIqModels,
  logCollisionIqModelDiagnostic,
} from "@/lib/modelConfig";

// Collision IQ annotated-estimate / Citation Density prompt runner.
//
// Previously this called an OpenAI-hosted stored prompt
// (pmpt_69feb16e...). That prompt has been reconstructed inline for Claude so
// the behavior lives in the repo, is reviewable, and is tuned for the
// accuracy goals captured in citation-density-full-tooling-and-ledger.md:
//   - annotate EVERY material row-backed estimate difference (no top-4 cap)
//   - keep estimate-delta findings separate from OEM repair-support findings
//   - never assert "OEM requires" without actual OEM/procedure/position support
//   - label authority gaps precisely (NEEDS OEM / NEEDS INVOICE / REFERENCED
//     NOT PRODUCED / ESTIMATE GAP ONLY / WEAK — DO NOT LEAD)
//   - treat Work Authorization / contract text as support context only

type CollisionIqAudience = "customer" | "estimator" | "admin";

type CollisionIqAnnotationMode =
  | "annotated_estimate_review"
  | "estimator_change_request_list"
  | "repair_intelligence_summary";

export type RunCollisionIqPromptArgs = {
  user_request: string;
  case_context?: string;
  uploaded_documents?: string;
  applicability_instruction?: string;
  carrier_estimate_text?: string;
  shop_estimate_text?: string;
  scrubber_findings?: string;
  audience?: CollisionIqAudience;
  annotation_mode?: CollisionIqAnnotationMode;
};

const BASE_SYSTEM_PROMPT = `You are Collision IQ, a forensic collision-repair file reviewer. You turn estimates, supplements, photos, invoices, scan/calibration records, and OEM procedures into an evidence-backed repair position. You explain what the file supports, what remains unproven, and what documentation should be requested next. You never claim one estimate is simply "right" and the other "wrong" — you ground every finding in the documents provided.

Hard rules:
- Annotate EVERY material, row-backed estimate difference. Do not stop after a handful of findings. If the estimates contain more than four material differences (procedure research, bumper operations, brackets, closure panels, headlamp, refinish, blend, ADAS/calibration, alignment, etc.), surface all of them.
- Keep estimate-difference findings separate from OEM repair-support findings. An "estimate gap" is a difference between the shop and carrier estimates. An "OEM support" claim requires actual OEM procedure, position statement, or P-page text in the file.
- Never write "OEM requires" or "OEM mandates" unless real OEM / MOTOR / procedure / position-statement support is present in the provided documents. If authority is missing, label it precisely instead.
- Use these authority/gap labels where relevant: NEEDS OEM, NEEDS ADAS, NEEDS P-PAGE, NEEDS INVOICE, REFERENCED / NOT PRODUCED, ESTIMATE GAP ONLY, WEAK — DO NOT LEAD.
- Do not anchor findings to weak sources: work authorizations, insurer boilerplate, vehicle headers/identity, generic notes, abbreviation/legend pages, or supplier-only rows when real estimate rows exist.
- Treat Work Authorization / Contract of Repair as support context only (authorization, posted rates, inspection demand). It is never a primary estimate source, scan proof, final invoice, carrier estimate, or estimate-row anchor.
- Do not fabricate evidence. If an item is uploaded but not tied to a line, say "present but not line-tied". If referenced but not produced, say "referenced / not produced". Only say "not located" when no matching or candidate files exist.
- Ground all numbers and line references in the supplied estimate text. Quote the relevant line or section wording when you anchor a finding.`;

function audienceGuidance(audience: CollisionIqAudience): string {
  switch (audience) {
    case "customer":
      return "Audience: vehicle owner. Use plain language, avoid estimating jargon, and focus on what is more complete, what affects safety, and what still needs proof.";
    case "admin":
      return "Audience: Collision IQ admin/reviewer. Be precise and technical; expose evidence reasoning and authority gaps explicitly.";
    case "estimator":
    default:
      return "Audience: estimator / appraiser / claim professional. Be technical, procedural, and negotiation-aware; tie each finding to a specific estimate line or section.";
  }
}

function modeGuidance(mode: CollisionIqAnnotationMode): string {
  switch (mode) {
    case "estimator_change_request_list":
      return `Produce a concrete change-request list. For each item give: the estimate line/section it attaches to, what should change (add/restore/document/verify), the supporting reason, the authority/gap label, and the documentation to request. Cover every material row-backed difference.`;
    case "repair_intelligence_summary":
      return `Produce a Repair Intelligence summary: the strongest repair arguments, where the file is weak, ADAS/scan/calibration posture, parts-source differences (OEM/aftermarket/CAPA/LKQ), and the documentation that should be requested next. Separate "supported by evidence" from "needs proof".`;
    case "annotated_estimate_review":
    default:
      return `Produce an annotated estimate review. For each material finding output a compact block:
- LINE/SECTION: <the estimate line or section text it anchors to>
- FINDING: <missing / reduced / under-documented / proof-needed / part-source difference>
- BASIS: <what in the file supports or fails to support it — quote the row or section>
- LABEL: <one of NEEDS OEM, NEEDS ADAS, NEEDS P-PAGE, NEEDS INVOICE, REFERENCED / NOT PRODUCED, ESTIMATE GAP ONLY, WEAK — DO NOT LEAD, or SUPPORTED>
- NEXT: <documentation to request or action to take>
List all material findings, not just the top few.`;
  }
}

function buildUserContent(args: RunCollisionIqPromptArgs): string {
  const sections: Array<[string, string | undefined]> = [
    ["USER REQUEST", args.user_request],
    ["APPLICABILITY INSTRUCTION", args.applicability_instruction],
    ["CARRIER ESTIMATE TEXT", args.carrier_estimate_text],
    ["SHOP ESTIMATE TEXT", args.shop_estimate_text],
    ["SCRUBBER FINDINGS", args.scrubber_findings],
    ["UPLOADED DOCUMENTS", args.uploaded_documents],
  ];

  return sections
    .map(([label, value]) => {
      const text = typeof value === "string" ? value.trim() : "";
      if (!text) return "";
      return `## ${label}\n${text}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

export async function runCollisionIqPrompt(
  args: RunCollisionIqPromptArgs
): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }

  const audience = args.audience ?? "estimator";
  const annotationMode = args.annotation_mode ?? "annotated_estimate_review";

  const caseContext = typeof args.case_context === "string" ? args.case_context.trim() : "";
  const system = [
    BASE_SYSTEM_PROMPT,
    audienceGuidance(audience),
    modeGuidance(annotationMode),
    caseContext ? `Case context:\n${caseContext}` : "",
    args.applicability_instruction?.trim()
      ? `Applicability constraint:\n${args.applicability_instruction.trim()}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    logCollisionIqModelDiagnostic({
      stage: "annotated_estimate_prompt",
      provider: "anthropic",
      role: "anthropicPrimary",
      model: collisionIqModels.anthropicPrimary,
    });

    const response = await generateClaudeMessage({
      system,
      effort: "high",
      maxTokens: 16000,
      messages: [{ role: "user", content: buildUserContent(args) || args.user_request }],
    });

    return response.text;
  } catch (error) {
    const providerError = classifyAnthropicProviderError(error, "annotated_estimate_prompt");

    if (providerError.retryable) {
      console.warn("runCollisionIqPrompt retryable provider failure", {
        annotation_mode: args.annotation_mode,
        audience: args.audience,
        provider: providerError.provider,
        stage: providerError.stage,
        status: providerError.status,
        statusCode: providerError.statusCode,
        code: providerError.code,
      });

      const retryableError = Object.assign(new Error(RETRYABLE_PROVIDER_USER_MESSAGE), {
        retryable: true,
        provider: providerError.provider,
        stage: providerError.stage,
        status: providerError.status,
        statusCode: providerError.statusCode,
        code: providerError.code,
      });
      throw retryableError;
    }

    console.error("runCollisionIqPrompt failed", {
      annotation_mode: args.annotation_mode,
      audience: args.audience,
      error,
    });

    throw error;
  }
}
