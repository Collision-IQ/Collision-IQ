import "server-only";
import {
  classifyOpenAIProviderError,
  getOpenAIClient,
} from "@/lib/openai";
import { RETRYABLE_PROVIDER_USER_MESSAGE } from "@/lib/ai/providerRetryableError";
import {
  collisionIqModels,
  logCollisionIqModelDiagnostic,
} from "@/lib/modelConfig";

const COLLISION_IQ_GPT55_PROMPT_ID =
  "pmpt_69feb16e364c8194be0fece66f6e9b710b96573b2ae95f88";

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

export async function runCollisionIqPrompt(
  args: RunCollisionIqPromptArgs
): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  try {
    const baseSystemPrompt = typeof args.case_context === "string" ? args.case_context.trim() : "";
    const systemPrompt = `
${baseSystemPrompt}

${args.applicability_instruction ?? ""}
`.trim();

    logCollisionIqModelDiagnostic({
      stage: "annotated_estimate_prompt",
      provider: "openai",
      role: "primary",
      model: collisionIqModels.primary,
    });
    const response = await getOpenAIClient().responses.create({
      model: collisionIqModels.primary,
      prompt: {
        id: COLLISION_IQ_GPT55_PROMPT_ID,
        version: "1",
        variables: {
          user_request: args.user_request,
          case_context: systemPrompt,
          uploaded_documents: args.uploaded_documents ?? "",
          applicability_instruction: args.applicability_instruction ?? "",
          carrier_estimate_text: args.carrier_estimate_text ?? "",
          shop_estimate_text: args.shop_estimate_text ?? "",
          scrubber_findings: args.scrubber_findings ?? "",
          audience: args.audience ?? "estimator",
          annotation_mode: args.annotation_mode ?? "annotated_estimate_review",
        },
      },
    });

    return response.output_text ?? "";
  } catch (error) {
    const providerError = classifyOpenAIProviderError(error, "annotated_estimate_prompt");

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
