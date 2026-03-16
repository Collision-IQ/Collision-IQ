import { hybridSearch } from "@/lib/rag/search";
import type { RetrieveResult } from "@/lib/rag/retrieve";

export interface RetrievalContext {
  vehicle?: string;
  system?: string;
  component?: string;
  procedure?: string;
  query: string;
}

export interface RetrievalHit extends RetrieveResult {
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
        id: `${hit.drive_path ?? "unknown"}:${hit.text.slice(0, 80)}`,
        text: hit.text ?? "",
        drive_path: hit.drive_path ?? null,
        similarity: hit.similarity ?? null,
        oem: hit.oem ?? null,
        system: hit.system ?? null,
        component: hit.component ?? null,
        procedure: hit.procedure ?? null,
        source: hit.drive_path ?? "Unknown",
        score: hit.similarity ?? null,
      }));
    })
  );

  const merged = results.flat();
  const unique = Array.from(new Map(merged.map((result) => [result.id, result])).values());

  return unique.slice(0, 8);
}
