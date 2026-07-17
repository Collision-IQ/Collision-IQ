import { generatePrimaryText } from "@/lib/ai/providerTextGeneration";
import type { ClaudeEffort } from "@/lib/anthropic";

export async function generateChatCompletion(params: {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  /** Match effort/output budget to the question depth — simple follow-ups
   * should not pay for extended high-effort reasoning. */
  effort?: ClaudeEffort;
  maxTokens?: number;
}): Promise<string> {
  const response = await generatePrimaryText({
    stage: "generate_chat_completion",
    instructions: params.system,
    effort: params.effort,
    maxTokens: params.maxTokens,
    input: params.messages.map((message) => ({
      role: message.role,
      content: [
        {
          type: "input_text",
          text: message.content,
        },
      ],
    })),
  });

  return response.output_text.trim() || "";
}
