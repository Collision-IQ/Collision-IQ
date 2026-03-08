import { prisma } from "@/lib/prisma";
import { keywordSearch } from "./keywordSearch";
import OpenAI from "openai";

const openai = new OpenAI();

type ChunkMatch = {
  text: string;
  drive_path: string | null;
  similarity: number | null;
};

/**
 * Converts embedding array into pgvector literal: '[1,2,3]'
 */
function toVectorLiteral(embedding: number[]) {
  if (!Array.isArray(embedding) || embedding.length === 0) return null;

  const safe = embedding
    .map((n) => (Number.isFinite(n) ? n : 0))
    .join(",");

  return `[${safe}]`;
}

export async function searchSimilarChunks(
  embedding: number[],
  limit = 5
): Promise<ChunkMatch[]> {

  const vec = toVectorLiteral(embedding);
  if (!vec) return [];

  const rows = (await prisma.$queryRawUnsafe(`
    SELECT
      text,
      drive_path,
      1 - (embedding <=> '${vec}') AS similarity
    FROM document_chunks
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> '${vec}'
    LIMIT ${Math.max(1, Math.min(limit, 20))};
  `)) as ChunkMatch[];

  return rows ?? [];
}

export async function hybridSearch(query: string) {

  const embeddingResponse = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: query
  });

  const embedding = embeddingResponse.data[0].embedding;

  const vectorResults = await searchSimilarChunks(embedding, 5);
  const keywordResults = await keywordSearch(query, 5);

  const combined: ChunkMatch[] = [
    ...vectorResults,
    ...keywordResults
  ];

  const unique = new Map<string, ChunkMatch>();

  for (const r of combined) {
    unique.set(r.text, r);
  }

  const candidates = [...unique.values()].slice(0, 10);

  const { rerankChunks } = await import("./rerank");

  return await rerankChunks(query, candidates, 3);
}