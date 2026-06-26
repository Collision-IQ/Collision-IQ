import { VoyageAIClient } from "voyageai";

// Embeddings provider for Collision IQ RAG.
//
// Anthropic/Claude has no embeddings API, so vector search is powered by
// Voyage AI (Anthropic's recommended embeddings partner). Configure with:
//   VOYAGE_API_KEY        - required
//   VOYAGE_EMBED_MODEL    - optional, defaults to "voyage-3-large"
//
// NOTE: switching embedding providers changes the vector space. Any rows
// previously embedded with OpenAI text-embedding-3-small must be re-ingested
// before similarity search is meaningful again.

const VOYAGE_MODEL = (process.env.VOYAGE_EMBED_MODEL || "voyage-3-large").trim();
const MAX_INPUT_CHARS = 20000;
const MAX_BATCH = 128; // Voyage hard limit per request.

if (!process.env.VOYAGE_API_KEY) {
  console.error("❌ Missing VOYAGE_API_KEY (rag/embed.ts)");
}

let voyageClient: VoyageAIClient | null = null;

function getVoyageClient(): VoyageAIClient {
  const apiKey = process.env.VOYAGE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("VOYAGE_API_KEY is not configured.");
  }
  if (!voyageClient) {
    voyageClient = new VoyageAIClient({ apiKey });
  }
  return voyageClient;
}

async function embedBatch(
  inputs: string[],
  inputType: "query" | "document"
): Promise<number[][]> {
  if (!inputs.length) return [];
  const res = await getVoyageClient().embed({
    input: inputs,
    model: VOYAGE_MODEL,
    inputType,
  });
  return (res.data ?? []).map((item) => item.embedding ?? []);
}

/**
 * Stable single-text embedder. Use this in chat/search code paths.
 */
export async function embedText(text: string): Promise<number[]> {
  const cleaned = (text || "").trim();
  if (!cleaned) return [];

  const [embedding] = await embedBatch([cleaned.slice(0, MAX_INPUT_CHARS)], "query");
  return embedding ?? [];
}

/**
 * Batch embedder. Use this in ingestion code. Splits into Voyage-sized batches.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const cleaned = texts
    .map((t) => (t || "").trim())
    .filter(Boolean)
    .map((t) => t.slice(0, MAX_INPUT_CHARS));

  if (!cleaned.length) return [];

  const results: number[][] = [];
  for (let i = 0; i < cleaned.length; i += MAX_BATCH) {
    const batch = cleaned.slice(i, i + MAX_BATCH);
    results.push(...(await embedBatch(batch, "document")));
  }
  return results;
}
