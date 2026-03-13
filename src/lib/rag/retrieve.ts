import { hybridSearch } from "@/lib/rag/search";

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

export type RetrieveResult = {
  text: string;
  drive_path?: string | null;
  similarity?: number | null;

  oem?: string | null;
  system?: string | null;
  component?: string | null;
  procedure?: string | null;
};

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

  const normalized: RetrieveResult[] = results.map((r: any) => ({
    text: r.text ?? "",
    drive_path: r.drive_path ?? null,
    similarity: r.similarity ?? null,
    oem: r.oem ?? null,
    system: r.system ?? null,
    component: r.component ?? null,
    procedure: r.procedure ?? null
  }));

  return normalized.slice(0, limit);
}