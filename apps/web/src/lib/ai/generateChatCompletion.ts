import { collisionIqModels } from "@/lib/modelConfig";
import { openai } from "@/lib/openai";

export async function generateChatCompletion(params: {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<string> {
  const response = await openai.chat.completions.create({
    model: collisionIqModels.primary,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: params.system,
      },
      ...params.messages,
    ],
  });

  return response.choices[0]?.message?.content?.trim() || "";
}
