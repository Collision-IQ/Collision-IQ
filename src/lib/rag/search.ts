import { keywordSearch } from "./keywordSearch";
import { embedText } from "./embed";
import type { RetrievedChunk } from "@/lib/types";
import { searchChunks } from "./searchChunks";

type ChunkMatch = RetrievedChunk;

/*
---------------------------------------------
Metadata detector
---------------------------------------------
*/
function detectMetadata(query: string) {
  const lower = query.toLowerCase();

  const match = (values: string[]) =>
    values.find((v) => lower.includes(v.toLowerCase())) ?? null;

  return {
    system: match([
      "ADAS",
      "SRS",
      "Airbag",
      "Radar",
      "Camera",
      "Blind Spot",
      "Lane Keep",
      "Parking Sensor",
      "Brake",
      "Steering",
    ]),
    component: match([
      "Radar",
      "Camera",
      "Windshield",
      "Bumper",
      "Grille",
      "Airbag",
      "Sensor",
      "Module",
    ]),
    procedure: match([
      "Calibration",
      "Diagnostic Scan",
      "Pre-Scan",
      "Post-Scan",
      "Verification",
      "Initialization",
      "Programming",
      "Reset",
      "Inspection",
      "Replacement",
      "Installation",
      "Removal",
      "Repairs and Inspections Required",
    ]),
  };
}

/*
---------------------------------------------
Hybrid search
---------------------------------------------
*/
export async function hybridSearch(query: string) {
  const metadata = detectMetadata(query);

  const embedding = await embedText(query);

  const vectorResults = (await searchChunks(embedding, 5)).map((chunk) => ({
    ...chunk,
  }));
  const keywordResults = (await keywordSearch(query, 5)).map((chunk) => ({
    ...chunk,
  }));

  const combined: ChunkMatch[] = [...vectorResults, ...keywordResults];

  /*
  ---------------------------------------------
  Deduplicate results
  ---------------------------------------------
  */
  const unique = new Map<string, ChunkMatch>();

  for (const r of combined) {
    unique.set(r.content, r);
  }

  let candidates = [...unique.values()];

  /*
  ---------------------------------------------
  Distance ranking
  ---------------------------------------------
  */
  candidates = candidates
    .sort(
      (a, b) =>
        (a.distance ?? Number.POSITIVE_INFINITY) -
        (b.distance ?? Number.POSITIVE_INFINITY)
    )
    .slice(0, 10);

  /*
  ---------------------------------------------
  Rerank using LLM
  ---------------------------------------------
  */
  const { rerankChunks } = await import("./rerank");

  return await rerankChunks(query, candidates, 3);
}
