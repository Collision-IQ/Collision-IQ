import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

if (!process.env.OPENAI_API_KEY) {
  console.error("❌ Missing OPENAI_API_KEY (rag/embed.ts)");
}

/**
 * Stable single-text embedder
 * Use this in chat/search code paths.
 */
export async function embedText(text: string): Promise<number[]> {
  const cleaned = (text || "").trim();
  if (!cleaned) return [];

  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: cleaned.slice(0, 20000)
  });

  return res.data?.[0]?.embedding ?? [];
}

/**
 * Batch embedder
 * Use this only in ingestion code.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const cleaned = texts
    .map(t => (t || "").trim())
    .filter(Boolean)
    .map(t => t.slice(0, 20000));

  if (!cleaned.length) return [];

  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: cleaned
  });

  return res.data.map(d => d.embedding);
}