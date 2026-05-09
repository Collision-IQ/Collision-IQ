import "server-only";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
    const response = await openai.responses.create({
      prompt: {
        id: COLLISION_IQ_GPT55_PROMPT_ID,
        version: "1",
        variables: {
          user_request: args.user_request,
          case_context: args.case_context ?? "",
          uploaded_documents: args.uploaded_documents ?? "",
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
    console.error("runCollisionIqPrompt failed", {
      annotation_mode: args.annotation_mode,
      audience: args.audience,
      error,
    });

    throw error;
  }
}
