import type { RetrievedChunk } from "@/lib/types";
import {
  buildOpenAiResponsesRequest,
  collisionIqModels,
  logCollisionIqModelDiagnostic,
} from "@/lib/modelConfig";
import { openai } from "@/lib/openai";

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
You are ranking OEM procedure excerpts by practical relevance to a real collision repair scenario.

Query:
${query}

Passages:
${chunks
  .map((c, i) => `[${i}] ${c.content.substring(0, 500)}`)
  .join("\n\n")}

Prioritize:
- direct applicability to repair operations
- procedures that affect calibration, safety, or required verification
- contextually relevant systems (ADAS, structural, restraint, alignment)

Deprioritize:
- generic or overly broad procedures
- unrelated systems
- redundant or duplicate content

Return the numbers of the ${topK} most relevant passages in order.
`;

  logCollisionIqModelDiagnostic({
    stage: "rag_rerank",
    provider: "openai",
    role: "helper",
    model: collisionIqModels.helper,
  });
  const res = await openai.responses.create(buildOpenAiResponsesRequest({
    model: collisionIqModels.helper,
    input: [
      {
        role: "user" as const,
        content: [
          {
            type: "input_text" as const,
            text: prompt,
          },
        ],
      },
    ],
  }));

  const text = res.output_text || "";

  const indexes = [...text.matchAll(/\d+/g)]
    .map((m) => Number(m[0]))
    .filter((i) => i < chunks.length)
    .slice(0, topK);

  return indexes.map((i) => chunks[i]);
}
