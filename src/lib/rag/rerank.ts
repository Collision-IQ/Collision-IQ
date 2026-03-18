import OpenAI from "openai";
import type { RetrievedChunk } from "@/lib/types";

const openai = new OpenAI();

type ChunkMatch = RetrievedChunk & {
  system?: string | null;
  component?: string | null;
  procedure?: string | null;
};

export async function rerankChunks(
  query: string,
  chunks: ChunkMatch[],
  topK = 3
): Promise<ChunkMatch[]> {

  if (!chunks.length) return [];

  const prompt = `
You are ranking document passages by relevance.

Query:
${query}

Passages:
${chunks
  .map((c, i) => `[${i}] ${c.content.substring(0, 500)}`)
  .join("\n\n")}

Return the numbers of the ${topK} most relevant passages in order.
`;

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
  });

  const text = res.choices[0].message.content || "";

  const indexes = [...text.matchAll(/\d+/g)]
    .map((m) => Number(m[0]))
    .filter((i) => i < chunks.length)
    .slice(0, topK);

  return indexes.map((i) => chunks[i]);
}
