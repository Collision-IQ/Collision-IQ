import { hybridSearch } from "@/lib/rag/search";
import type { RetrieveResult } from "@/lib/rag/retrieve";
import type { RetrievedChunk } from "@/lib/types";

export interface RetrievalContext {
  vehicle?: string;
  system?: string;
  component?: string;
  procedure?: string;
  query: string;
}

export interface RetrievalHit extends RetrievedChunk {
  id: string;
  source: string;
  score: number | null;
}

export async function runRetrieval(
  context: RetrievalContext
): Promise<RetrievalHit[]> {
  const queries: string[] = [];

  queries.push(context.query);

  if (context.vehicle) queries.push(`${context.vehicle} repair procedure`);
  if (context.component) queries.push(`${context.component} removal procedure`);
  if (context.system) queries.push(`${context.system} calibration requirement`);
  if (context.procedure) queries.push(`${context.procedure} OEM procedure`);

  const results = await Promise.all(
    queries.map(async (query) => {
      const hits = await hybridSearch(query);
      return hits.slice(0, 5).map((hit) => ({
        id: `${hit.file_id ?? "unknown"}:${hit.content.slice(0, 80)}`,
        content: hit.content ?? "",
        file_id: hit.file_id ?? "",
        distance: hit.distance ?? null,
        source: hit.file_id ?? "Unknown",
        score: hit.distance ?? null,
      }));
    })
  );

  const merged = results.flat();
  const unique = Array.from(new Map(merged.map((result) => [result.id, result])).values());

  return unique.slice(0, 8);
}
