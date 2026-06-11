import { openai } from "@/lib/openai";
import { generatePrimaryText } from "@/lib/ai/providerTextGeneration";

export async function generateChatCompletion(params: {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<string> {
  const response = await generatePrimaryText({
    openai,
    stage: "generate_chat_completion",
    instructions: params.system,
    temperature: 0.2,
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
