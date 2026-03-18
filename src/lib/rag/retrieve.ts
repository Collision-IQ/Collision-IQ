import { hybridSearch } from "@/lib/rag/search";
import type { RetrievedChunk } from "@/lib/types";

export type RetrieveParams = {
  query: string;

  // optional vehicle context
  vehicle?: string | null;

  // future metadata filters
  system?: string | null;
  component?: string | null;
  procedure?: string | null;

  limit?: number;
};

export type RetrieveResult = RetrievedChunk;

/*
---------------------------------------------
Retrieve Documents (RAG Entry Point)
---------------------------------------------
*/
export async function retrieveDocuments(
  params: RetrieveParams
): Promise<RetrieveResult[]> {

  const {
    query,
    vehicle,
    system,
    component,
    procedure,
    limit = 5
  } = params;

  /*
  ---------------------------------------------
  Expand query using context (lightweight)
  ---------------------------------------------
  */

  let contextualQuery = query;

  if (vehicle) {
    contextualQuery += ` vehicle:${vehicle}`;
  }

  if (system) {
    contextualQuery += ` system:${system}`;
  }

  if (component) {
    contextualQuery += ` component:${component}`;
  }

  if (procedure) {
    contextualQuery += ` procedure:${procedure}`;
  }

  /*
  ---------------------------------------------
  Run hybrid search
  ---------------------------------------------
  */

  const results = await hybridSearch(contextualQuery);

  /*
  ---------------------------------------------
  Normalize results
  ---------------------------------------------
  */

  const normalized: RetrieveResult[] = results.map(
    (r: Awaited<ReturnType<typeof hybridSearch>>[number]) => ({
      content: r.content ?? "",
      file_id: r.file_id ?? "",
      distance: r.distance ?? null,
    })
  );

  return normalized.slice(0, limit);
}
