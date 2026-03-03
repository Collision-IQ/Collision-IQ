import OpenAI from "openai";

if (!process.env.OPENAI_API_KEY) {
  console.error("❌ Missing OPENAI_API_KEY (rag/embed.ts)");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

/**
 * Embeds text for vector search.
 * Uses 1536-dim embeddings to match VECTOR(1536).
 */
export async function embedText(text: string): Promise<number[]> {
  const cleaned = (text || "").trim();
  if (!cleaned) return [];

  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: cleaned.slice(0, 20_000), // safety cap
  });

  return res.data?.[0]?.embedding ?? [];
}