import { prisma } from "@/lib/prisma";
import { keywordSearch } from "./keywordSearch";
import { embedText } from "./embed";

type ChunkMatch = {
  text: string;
  drive_path: string | null;
  similarity: number | null;
  oem?: string | null;
  system?: string | null;
  component?: string | null;
  procedure?: string | null;
};

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
    oem: match([
      "Honda",
      "Toyota",
      "Ford",
      "GM",
      "Chevrolet",
      "Nissan",
      "Hyundai",
      "Kia",
      "Subaru",
      "Mazda",
      "BMW",
      "Mercedes",
      "Audi",
      "Volkswagen",
    ]),
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
Convert embedding → pgvector literal
---------------------------------------------
*/
function toVectorLiteral(embedding: number[]) {
  if (!Array.isArray(embedding) || embedding.length === 0) return null;

  const safe = embedding
    .map((n) => (Number.isFinite(n) ? n : 0))
    .join(",");

  return `[${safe}]`;
}

/*
---------------------------------------------
Vector similarity search
---------------------------------------------
*/
export async function searchSimilarChunks(
  embedding: number[],
  limit = 5,
  oem?: string | null
): Promise<ChunkMatch[]> {
  const vec = toVectorLiteral(embedding);
  if (!vec) return [];

  const rows = (await prisma.$queryRawUnsafe(`
    SELECT
      text,
      drive_path,
      oem,
      system,
      component,
      procedure,
      1 - (embedding <=> '${vec}') AS similarity
    FROM document_chunks
    WHERE embedding IS NOT NULL
    ${oem ? `AND oem = '${oem}'` : ""}
    ORDER BY embedding <=> '${vec}'
    LIMIT ${Math.max(1, Math.min(limit, 20))}
  `)) as ChunkMatch[];

  return rows ?? [];
}

/*
---------------------------------------------
Hybrid search
---------------------------------------------
*/
export async function hybridSearch(query: string) {
  const metadata = detectMetadata(query);

  const embedding = await embedText(query);

  const vectorResults = await searchSimilarChunks(embedding, 5, metadata.oem);
  const keywordResults = await keywordSearch(query, 5);

  const combined: ChunkMatch[] = [...vectorResults, ...keywordResults];

  /*
  ---------------------------------------------
  Deduplicate results
  ---------------------------------------------
  */
  const unique = new Map<string, ChunkMatch>();

  for (const r of combined) {
    unique.set(r.text, r);
  }

  let candidates = [...unique.values()];

  /*
  ---------------------------------------------
  Metadata boost scoring
  ---------------------------------------------
  */
  candidates = candidates
    .map((c) => {
      let score = c.similarity ?? 0;

      if (metadata.oem && c.oem === metadata.oem) score += 0.3;
      if (metadata.system && c.system === metadata.system) score += 0.2;
      if (metadata.component && c.component === metadata.component) score += 0.2;
      if (metadata.procedure && c.procedure === metadata.procedure) score += 0.2;

      return { ...c, similarity: score };
    })
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, 10);

  /*
  ---------------------------------------------
  Rerank using LLM
  ---------------------------------------------
  */
  const { rerankChunks } = await import("./rerank");

  return await rerankChunks(query, candidates, 3);
}